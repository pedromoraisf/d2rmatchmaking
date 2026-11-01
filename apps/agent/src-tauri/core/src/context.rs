//! The state the core loops share: the ports, the API client, the signals between loops and the agent view (design.md
//! § Runtime, state and telemetry). Loops never hold a lock across an await; the view is published after each change.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tokio::sync::{Notify, watch};
use tokio::time::Instant;

use crate::api_client::{ApiClient, ApiError};
use crate::config::Config;
use crate::contracts::generated::Assignment;
use crate::ports::{IdGenerator, ProcessSource, StateSink, TextReader, TokenStore, WallClock};
use crate::updates::Updater;
use crate::view::{AgentView, Connectivity, PairingView, RoomView, UpdateView};

/// The ports the app hands to the core. Each loop reaches the outside world only through these.
pub struct Adapters {
    pub tokens: Arc<dyn TokenStore + Send + Sync>,
    pub processes: Arc<dyn ProcessSource + Send + Sync>,
    pub reader: Arc<dyn TextReader + Send + Sync>,
    pub ids: Arc<dyn IdGenerator + Send + Sync>,
    pub updater: Arc<dyn Updater>,
    pub clock: Arc<dyn WallClock + Send + Sync>,
    pub sink: Arc<dyn StateSink + Send + Sync>,
}

/// Owns the agent view and publishes every change through the state sink (AGS-34).
pub struct Hub {
    sink: Arc<dyn StateSink + Send + Sync>,
    view: Mutex<AgentView>,
}

impl Hub {
    fn new(sink: Arc<dyn StateSink + Send + Sync>) -> Self {
        Self {
            sink,
            view: Mutex::new(AgentView {
                pairing: PairingView::Requesting,
                connectivity: Connectivity::Connected,
                room: None,
                update: UpdateView::Idle,
            }),
        }
    }

    fn change(&self, apply: impl FnOnce(&mut AgentView)) {
        let snapshot = {
            let mut view = lock(&self.view);
            apply(&mut view);
            view.clone()
        };
        self.sink.publish(snapshot);
    }

    pub fn set_pairing(&self, pairing: PairingView) {
        self.change(|view| view.pairing = pairing);
    }

    pub fn set_connectivity(&self, connectivity: Connectivity) {
        self.change(|view| view.connectivity = connectivity);
    }

    pub fn set_room(&self, room: Option<RoomView>) {
        self.change(|view| view.room = room);
    }

    pub fn set_update(&self, update: UpdateView) {
        self.change(|view| view.update = update);
    }

    pub fn snapshot(&self) -> AgentView {
        lock(&self.view).clone()
    }
}

/// Everything the loops share. Built once by `Context::new` and kept in an `Arc`.
pub struct Context {
    pub version: String,
    pub api: ApiClient,
    pub tokens: Arc<dyn TokenStore + Send + Sync>,
    pub processes: Arc<dyn ProcessSource + Send + Sync>,
    pub reader: Arc<dyn TextReader + Send + Sync>,
    pub ids: Arc<dyn IdGenerator + Send + Sync>,
    pub updater: Arc<dyn Updater>,
    pub clock: Arc<dyn WallClock + Send + Sync>,
    pub hub: Hub,
    /// `true` while the agent holds a token (set by pairing, cleared by a 401).
    pub paired: watch::Sender<bool>,
    /// `true` after a 426 until an update installs (AGS-27). Every API loop waits while it is set.
    pub update_required: watch::Sender<bool>,
    /// Wakes the update loop for a check right after a 426 (AD-049).
    pub update_now: Notify,
    /// The current room assignment (AGS-14). Latest `room.assigned` wins.
    pub assignment: watch::Sender<Option<Assignment>>,
    /// Bumped by a 401 or a 426: pending observation retries compare it and drop (AD-051).
    epoch: AtomicU64,
    observations_dropped: AtomicU64,
}

impl Context {
    pub fn new(config: &Config, http: reqwest::Client, adapters: Adapters) -> Arc<Self> {
        Arc::new(Self {
            version: config.version.clone(),
            api: ApiClient::new(config, http),
            tokens: adapters.tokens,
            processes: adapters.processes,
            reader: adapters.reader,
            ids: adapters.ids,
            updater: adapters.updater,
            clock: adapters.clock,
            hub: Hub::new(adapters.sink),
            paired: watch::channel(false).0,
            update_required: watch::channel(false).0,
            update_now: Notify::new(),
            assignment: watch::channel(None).0,
            epoch: AtomicU64::new(0),
            observations_dropped: AtomicU64::new(0),
        })
    }

    /// A 401 on any request: the token goes, the room goes, and the pairing loop shows a new code (AGS-08).
    pub fn on_unauthorized(&self) {
        self.tokens.delete();
        self.paired.send_replace(false);
        self.assignment.send_replace(None);
        self.hub.set_room(None);
        self.hub.set_pairing(PairingView::Requesting);
        self.epoch.fetch_add(1, Ordering::SeqCst);
    }

    /// A 426 on any request: the API loops stop until an update installs and the update loop checks now (AGS-27).
    pub fn on_upgrade_required(&self) {
        self.update_required.send_replace(true);
        self.hub.set_update(UpdateView::Required);
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.update_now.notify_one();
    }

    /// Applies what a failed API request means for the whole agent: a 401 is `on_unauthorized`, a 426 is
    /// `on_upgrade_required`. Every other error changes nothing here; each loop decides what its own failure means.
    pub fn handle_api_error(&self, error: &ApiError) {
        match error {
            ApiError::Unauthorized => self.on_unauthorized(),
            ApiError::UpgradeRequired => self.on_upgrade_required(),
            _ => {}
        }
    }

    /// The current epoch. A retry that started under an older epoch was overtaken by a 401 or 426.
    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }

    pub fn count_dropped_observation(&self) {
        self.observations_dropped.fetch_add(1, Ordering::SeqCst);
    }

    /// Observations dropped after their retries ran out or were overtaken (AD-051).
    pub fn dropped_observations(&self) -> u64 {
        self.observations_dropped.load(Ordering::SeqCst)
    }

    /// Whether the API loops may run: the agent holds a token and no 426 is pending.
    pub fn api_allowed(&self) -> bool {
        let paired = *self.paired.borrow();
        let blocked = *self.update_required.borrow();
        paired && !blocked
    }

    /// Whether the pairing loop may run: no 426 is pending.
    pub fn pairing_allowed(&self) -> bool {
        !*self.update_required.borrow()
    }

    /// Resolves once `allowed` holds, re-checking whenever the paired or update state changes.
    pub async fn wait_until_allowed(&self, allowed: fn(&Context) -> bool) {
        let mut paired = self.paired.subscribe();
        let mut blocked = self.update_required.subscribe();
        while !allowed(self) {
            tokio::select! {
                _ = paired.changed() => {}
                _ = blocked.changed() => {}
            }
        }
    }

    /// Resolves once `allowed` stops holding: the stream reader uses it to close a connection on a 401 or a 426.
    pub async fn wait_until_closed(&self, allowed: fn(&Context) -> bool) {
        let mut paired = self.paired.subscribe();
        let mut blocked = self.update_required.subscribe();
        while allowed(self) {
            tokio::select! {
                _ = paired.changed() => {}
                _ = blocked.changed() => {}
            }
        }
    }

    /// Sleeps until `deadline`. Returns `true` when the deadline passed while `allowed` still holds, `false` as soon as
    /// it stops holding (a 401 or a 426 interrupts the sleep).
    pub async fn sleep_while_allowed(
        &self,
        deadline: Instant,
        allowed: fn(&Context) -> bool,
    ) -> bool {
        let mut paired = self.paired.subscribe();
        let mut blocked = self.update_required.subscribe();
        loop {
            if !allowed(self) {
                return false;
            }
            if Instant::now() >= deadline {
                return true;
            }
            tokio::select! {
                () = tokio::time::sleep_until(deadline) => {}
                _ = paired.changed() => {}
                _ = blocked.changed() => {}
            }
        }
    }
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use chrono::{DateTime, Utc};

    use super::{Adapters, Context};
    use crate::api_client::ApiError;
    use crate::config::{AllowLoopbackHttp, ApiBase, Config};
    use crate::contracts::generated::Assignment;
    use crate::ports::{
        ProcessSource, ReadError, ReadText, Region, Rgba, SequentialIds, StateSink, StoreError,
        TextReader, TokenStore, UpdateOutcome, WallClock,
    };
    use crate::secret::Secret;
    use crate::stream::{StreamEffect, handle};
    use crate::updates::Updater;
    use crate::view::{AgentView, PairingView, RoomView};

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";
    const ASSIGNED: &str = r#"{"roomId":"7d9f2c1e-0000-4000-8000-000000000001","run":1,"expectedGameName":"mmbaalh-12","members":[{"accountId":"account-1","characterId":null,"joinOrder":1,"role":"host"}]}"#;

    /// Holds the token in memory.
    #[derive(Default)]
    struct MemoryTokens(Mutex<Option<Secret>>);

    impl TokenStore for MemoryTokens {
        fn load(&self) -> Option<Secret> {
            self.0
                .lock()
                .expect("the token lock is not poisoned")
                .clone()
        }

        fn save(&self, token: &Secret) -> Result<(), StoreError> {
            *self.0.lock().expect("the token lock is not poisoned") = Some(token.clone());
            Ok(())
        }

        fn delete(&self) {
            *self.0.lock().expect("the token lock is not poisoned") = None;
        }
    }

    struct NoProcesses;

    impl ProcessSource for NoProcesses {
        fn names(&self) -> Vec<String> {
            Vec::new()
        }
    }

    struct NoText;

    impl TextReader for NoText {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Err(ReadError::EngineUnavailable)
        }
    }

    struct NoUpdates;

    impl Updater for NoUpdates {
        fn check_boxed(&self) -> Pin<Box<dyn Future<Output = UpdateOutcome> + Send + '_>> {
            Box::pin(async { UpdateOutcome::UpToDate })
        }
    }

    struct FixedClock;

    impl WallClock for FixedClock {
        fn now_utc(&self) -> DateTime<Utc> {
            "2026-10-31T10:00:00Z".parse().expect("a valid instant")
        }
    }

    struct NullSink;

    impl StateSink for NullSink {
        fn publish(&self, _view: AgentView) {}
    }

    /// A paired context holding a token and no room, with every port faked in memory.
    fn paired_context() -> (Arc<Context>, Arc<MemoryTokens>) {
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let config = Config {
            version: "0.0.1".to_string(),
            api_base: ApiBase::parse("https://api.example.test", AllowLoopbackHttp::No)
                .expect("a valid API base"),
        };
        let adapters = Adapters {
            tokens: tokens.clone(),
            processes: Arc::new(NoProcesses),
            reader: Arc::new(NoText),
            ids: Arc::new(SequentialIds::new()),
            updater: Arc::new(NoUpdates),
            clock: Arc::new(FixedClock),
            sink: Arc::new(NullSink),
        };
        let ctx = Context::new(&config, reqwest::Client::new(), adapters);
        ctx.paired.send_replace(true);
        (ctx, tokens)
    }

    fn assignment() -> Assignment {
        match handle("room.assigned", ASSIGNED) {
            StreamEffect::SetAssignment(assignment) => assignment,
            StreamEffect::Ignore => panic!("the fixture is a valid room.assigned event"),
        }
    }

    #[test]
    fn unauthorized_deletes_token_clears_room_and_bumps_epoch() {
        let (ctx, tokens) = paired_context();
        ctx.assignment.send_replace(Some(assignment()));
        ctx.hub.set_room(Some(RoomView {
            game_name: "mmbaalh-12".to_string(),
        }));
        let epoch = ctx.epoch();

        ctx.on_unauthorized();

        assert!(tokens.load().is_none(), "the token is deleted");
        assert!(!*ctx.paired.borrow(), "the agent is no longer paired");
        assert!(
            ctx.assignment.borrow().is_none(),
            "the assignment is cleared"
        );
        assert_eq!(ctx.hub.snapshot().room, None, "the room is cleared");
        assert_eq!(ctx.hub.snapshot().pairing, PairingView::Requesting);
        assert_eq!(ctx.epoch(), epoch + 1, "pending retries are overtaken");
    }

    #[tokio::test(start_paused = true)]
    async fn upgrade_required_blocks_api_loops_and_wakes_the_update_check() {
        let (ctx, _tokens) = paired_context();
        assert!(
            ctx.api_allowed(),
            "a paired agent with no 426 may call the API"
        );

        ctx.on_upgrade_required();

        assert!(!ctx.api_allowed(), "a pending 426 blocks the API loops");
        assert!(*ctx.update_required.borrow());
        tokio::time::timeout(Duration::from_secs(1), ctx.update_now.notified())
            .await
            .expect("the update check is woken at once");
    }

    #[test]
    fn handle_api_error_routes_401_and_426_only() {
        let other_errors = [
            ApiError::Network,
            ApiError::Server,
            ApiError::Invalid,
            ApiError::Gone,
            ApiError::Pending,
            ApiError::RateLimited { retry_after: None },
        ];
        for error in other_errors {
            let (ctx, tokens) = paired_context();
            ctx.handle_api_error(&error);
            assert!(tokens.load().is_some(), "{error:?} keeps the token");
            assert!(*ctx.paired.borrow(), "{error:?} keeps the agent paired");
            assert!(!*ctx.update_required.borrow(), "{error:?} sets no 426");
            assert_eq!(ctx.epoch(), 0, "{error:?} overtakes no retry");
        }

        let (ctx, tokens) = paired_context();
        ctx.handle_api_error(&ApiError::Unauthorized);
        assert!(tokens.load().is_none(), "a 401 deletes the token");
        assert_eq!(ctx.epoch(), 1);

        let (ctx, _tokens) = paired_context();
        ctx.handle_api_error(&ApiError::UpgradeRequired);
        assert!(*ctx.update_required.borrow(), "a 426 sets the flag");
        assert_eq!(ctx.epoch(), 1);
    }
}
