//! The device state the loops share (design.md § State): the paired device rules, the room assignment, the signals that
//! wake the loops, the dropped-observation count and the hub. The rules run under a short lock. The effects a rule returns
//! are applied here, to the token store, the view and the update loop. No lock is held across an await.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use d2rmm_agent_domain::paired_device::{DeviceEffect, PairedDevice};
use d2rmm_agent_domain::room_assignment::{Assignment, RoomAssignment};
use tokio::sync::{Notify, watch};
use tokio::time::Instant;

use crate::hub::Hub;
use crate::messages::{ReadyCheckOpen, Screen};
use crate::party::PartyProgress;
use crate::ports::{ApiError, StateSink, TokenStore};
use crate::view::{PairingView, RoomView, UpdateView};

/// What the loops share about the device: the aggregate, the room and the signals that wake the loops.
pub struct DeviceState {
    device: Mutex<PairedDevice>,
    /// Publishes the agent view and owns the state sink (AGS-34).
    pub hub: Hub,
    /// `true` while the agent holds a token. Each change wakes the loops that wait on it.
    pub paired: watch::Sender<bool>,
    /// `true` after a 426 until an update installs (AGS-27). Each change wakes the loops that wait on it.
    pub update_required: watch::Sender<bool>,
    /// Wakes the update loop for a check right after a 426 (AD-049).
    pub update_now: Notify,
    /// The current room assignment (AGS-14). Latest `room.assigned` wins.
    pub assignment: watch::Sender<RoomAssignment>,
    /// The screen the last frame showed (CHR-04). The heartbeat reports it and beats at once when it changes.
    pub screen: watch::Sender<Screen>,
    /// Observations dropped after their retries ran out or were overtaken (AD-051).
    observations_dropped: AtomicU64,
    /// What the Party step has seen for the held run (AGN-05). It follows the assignment and is forgotten with it.
    party: Mutex<PartyProgress>,
    /// The ready check the account is in, while its time has not run out (RDY-07). The hotkey answers it.
    ready_check: Mutex<Option<HeldReadyCheck>>,
}

/// A held ready check and the monotonic instant its time runs out: the time left came from the server (RDY-11).
#[derive(Debug, Clone)]
struct HeldReadyCheck {
    id: String,
    until: Instant,
}

impl DeviceState {
    /// A device that holds no token, no room and no pending update.
    pub fn new(sink: Arc<dyn StateSink + Send + Sync>) -> Self {
        Self {
            device: Mutex::new(PairedDevice::unpaired()),
            hub: Hub::new(sink),
            paired: watch::channel(false).0,
            update_required: watch::channel(false).0,
            update_now: Notify::new(),
            assignment: watch::channel(RoomAssignment::empty()).0,
            screen: watch::channel(Screen::Unknown).0,
            observations_dropped: AtomicU64::new(0),
            party: Mutex::new(PartyProgress::default()),
            ready_check: Mutex::new(None),
        }
    }

    /// Forgets the held ready check, when the stream or the API says the account is in none (RDY-11).
    pub fn forget_ready_check(&self) {
        *lock(&self.ready_check) = None;
        self.hub.set_ready_check_open(false);
    }

    /// Holds a ready check the stream or the API says is open, and shows the hotkey that accepts it (RDY-07). Its time is
    /// counted from now on the monotonic clock, so the agent's own wall clock plays no part (RDY-11).
    pub fn open_ready_check(&self, check: ReadyCheckOpen) {
        *lock(&self.ready_check) = Some(HeldReadyCheck {
            id: check.id,
            until: Instant::now() + check.remaining,
        });
        self.hub.set_ready_check_open(true);
    }

    /// Forgets the held ready check when the stream says it ended, or the API says it is gone. A different id changes
    /// nothing, so a late end of an older check never hides the newer one.
    pub fn close_ready_check(&self, id: &str) {
        let mut held = lock(&self.ready_check);
        if held.as_ref().is_some_and(|check| check.id == id) {
            *held = None;
            drop(held);
            self.hub.set_ready_check_open(false);
        }
    }

    /// The id of the held ready check while the hotkey may still answer it: held, and its time has not run out (RDY-07).
    pub fn answerable_ready_check(&self) -> Option<String> {
        lock(&self.ready_check)
            .as_ref()
            .filter(|check| Instant::now() < check.until)
            .map(|check| check.id.clone())
    }

    /// Waits until the held check's time runs out and then forgets it, so the hotkey disarms even when no resolution
    /// arrives (RDY-11). Waits forever when no check is held; the select that calls it restarts whenever the held check
    /// changes.
    pub async fn disarm_at_deadline(&self) {
        let Some(until) = lock(&self.ready_check).as_ref().map(|check| check.until) else {
            std::future::pending::<()>().await;
            return;
        };
        tokio::time::sleep_until(until).await;
        let mut held = lock(&self.ready_check);
        if held
            .as_ref()
            .is_some_and(|check| Instant::now() >= check.until)
        {
            *held = None;
            drop(held);
            self.hub.set_ready_check_open(false);
        }
    }

    /// Records the screen the last frame showed. Only a change wakes the heartbeat (CHR-05).
    pub fn set_screen(&self, screen: Screen) {
        self.screen.send_if_modified(|current| {
            if *current == screen {
                false
            } else {
                *current = screen;
                true
            }
        });
    }

    /// Whether a token is held.
    pub fn is_paired(&self) -> bool {
        lock(&self.device).is_paired()
    }

    /// Records whether a token is held and wakes the loops that wait on it.
    pub fn set_paired(&self, paired: bool) {
        let mut device = lock(&self.device);
        device.set_paired(paired);
        self.publish(&device);
    }

    /// An installed update clears the pending 426 and wakes the API loops.
    pub fn update_installed(&self) {
        let mut device = lock(&self.device);
        device.update_installed();
        self.publish(&device);
    }

    /// Stores the assignment the API states (`Some`) or forgets the current one (`None`). A newer assignment replaces the
    /// older one.
    pub fn replace_assignment(&self, assignment: Option<Assignment>) {
        lock(&self.party).follow(assignment.as_ref());
        self.assignment.send_modify(|slot| match assignment {
            Some(assignment) => {
                slot.receive(assignment);
            }
            None => slot.clear(),
        });
    }

    /// Runs `apply` on the Party progress of the held run (AGN-05). Publish the room after a change with `publish_room`.
    pub fn with_party<T>(&self, apply: impl FnOnce(&mut PartyProgress) -> T) -> T {
        apply(&mut lock(&self.party))
    }

    /// Shows the held room with the Party progress: the name, the reveal hint (AGN-04) and the match (AGN-03). Publishes only
    /// a change, so a reading that changes nothing sends nothing to the window.
    pub fn publish_room(&self) {
        let room = self.assignment.borrow().current().map(|assignment| {
            let progress = lock(&self.party);
            RoomView {
                game_name: assignment.expected_game_name.as_str().to_string(),
                needs_reveal: progress.needs_reveal(),
                matched: progress.matched(),
            }
        });
        if self.hub.snapshot().room != room {
            self.hub.set_room(room);
        }
    }

    /// A 401 on any request: the token goes, the room goes, and the pairing loop shows a new code (AGS-08).
    pub fn on_unauthorized(&self, tokens: &dyn TokenStore) {
        self.change(tokens, PairedDevice::on_unauthorized);
    }

    /// A 426 on any request: the API loops stop until an update installs, and the update loop checks now (AGS-27).
    pub fn on_upgrade_required(&self, tokens: &dyn TokenStore) {
        self.change(tokens, PairedDevice::on_upgrade_required);
    }

    /// Applies what a failed API request means for the whole agent: a 401 is `on_unauthorized`, a 426 is
    /// `on_upgrade_required`. Every other error changes nothing here; each loop decides what its own failure means.
    pub fn handle_api_error(&self, error: &ApiError, tokens: &dyn TokenStore) {
        match error {
            ApiError::Unauthorized => self.on_unauthorized(tokens),
            ApiError::UpgradeRequired => self.on_upgrade_required(tokens),
            _ => {}
        }
    }

    /// The current retry epoch. A retry that started under an older epoch was overtaken by a 401 or a 426.
    pub fn epoch(&self) -> u64 {
        lock(&self.device).retry_epoch()
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
        lock(&self.device).api_allowed()
    }

    /// Whether the pairing loop may run: no 426 is pending.
    pub fn pairing_allowed(&self) -> bool {
        lock(&self.device).pairing_allowed()
    }

    /// Resolves once `allowed` holds, re-checking whenever the paired or update state changes.
    pub async fn wait_until_allowed(&self, allowed: fn(&DeviceState) -> bool) {
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
    pub async fn wait_until_closed(&self, allowed: fn(&DeviceState) -> bool) {
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
        allowed: fn(&DeviceState) -> bool,
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

    /// Runs one rule of the aggregate, mirrors its flags onto the wake signals and applies the effects it returns.
    fn change(&self, tokens: &dyn TokenStore, rule: fn(&mut PairedDevice) -> Vec<DeviceEffect>) {
        let effects = {
            let mut device = lock(&self.device);
            let effects = rule(&mut device);
            self.publish(&device);
            effects
        };
        self.apply(tokens, &effects);
    }

    /// Mirrors the aggregate's flags onto the watch channels the loops wait on.
    fn publish(&self, device: &PairedDevice) {
        self.paired.send_replace(device.is_paired());
        self.update_required.send_replace(device.update_required());
    }

    /// Applies each effect, in the order the rule returned it.
    fn apply(&self, tokens: &dyn TokenStore, effects: &[DeviceEffect]) {
        for effect in effects {
            match effect {
                DeviceEffect::ForgetToken => tokens.delete(),
                DeviceEffect::ClearRoom => {
                    self.assignment.send_modify(RoomAssignment::clear);
                    lock(&self.party).follow(None);
                    self.hub.set_room(None);
                }
                // The retry epoch moved with the aggregate; a waiting retry compares it and drops its observation.
                DeviceEffect::DropPendingRetries => {}
                DeviceEffect::AskNewCode => self.hub.set_pairing(PairingView::Requesting),
                DeviceEffect::RequireUpdate => self.hub.set_update(UpdateView::Required),
                DeviceEffect::CheckForUpdateNow => self.update_now.notify_one(),
            }
        }
    }
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::Arc;
    use std::time::Duration;

    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use super::DeviceState;
    use crate::fakes::{MemoryTokens, NullSink};
    use crate::ports::{ApiError, TokenStore};
    use crate::secret::Secret;
    use crate::view::{PairingView, RoomView, UpdateView};

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    /// A paired device and a token store that holds its token, with every port faked in memory.
    fn paired() -> (DeviceState, MemoryTokens) {
        let tokens = MemoryTokens::default();
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = DeviceState::new(Arc::new(NullSink));
        device.set_paired(true);
        (device, tokens)
    }

    fn assignment() -> Assignment {
        Assignment {
            room: RoomId::new("7d9f2c1e-0000-4000-8000-000000000001"),
            run: NonZeroU64::MIN,
            expected_game_name: GameName::new("mmbaalh-12"),
            members: Vec::new(),
        }
    }

    #[test]
    fn unauthorized_applies_forget_clear_drop_ask() {
        let (device, tokens) = paired();
        device.replace_assignment(Some(assignment()));
        device.hub.set_room(Some(RoomView {
            game_name: "mmbaalh-12".to_string(),
            needs_reveal: false,
            matched: false,
        }));
        let epoch = device.epoch();

        device.on_unauthorized(&tokens);

        assert!(tokens.load().is_none(), "ForgetToken deletes the token");
        assert!(!device.is_paired(), "the agent is no longer paired");
        assert!(
            device.assignment.borrow().current().is_none(),
            "ClearRoom clears the assignment"
        );
        assert_eq!(
            device.hub.snapshot().room,
            None,
            "ClearRoom clears the room"
        );
        assert_eq!(
            device.hub.snapshot().pairing,
            PairingView::Requesting,
            "AskNewCode shows the pairing screen"
        );
        assert_eq!(
            device.epoch(),
            epoch + 1,
            "DropPendingRetries overtakes pending retries"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn upgrade_required_applies_require_drop_check_now() {
        let (device, tokens) = paired();
        assert!(
            device.api_allowed(),
            "a paired agent with no 426 may call the API"
        );
        let epoch = device.epoch();

        device.on_upgrade_required(&tokens);

        assert!(!device.api_allowed(), "a pending 426 blocks the API loops");
        assert!(
            *device.update_required.borrow(),
            "RequireUpdate raises the gate"
        );
        assert_eq!(
            device.hub.snapshot().update,
            UpdateView::Required,
            "RequireUpdate shows update required"
        );
        assert_eq!(
            device.epoch(),
            epoch + 1,
            "DropPendingRetries overtakes pending retries"
        );
        tokio::time::timeout(Duration::from_secs(1), device.update_now.notified())
            .await
            .expect("CheckForUpdateNow wakes the update check at once");
        assert!(device.is_paired(), "a 426 keeps the token");
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
            let (device, tokens) = paired();
            device.handle_api_error(&error, &tokens);
            assert!(tokens.load().is_some(), "{error:?} keeps the token");
            assert!(device.is_paired(), "{error:?} keeps the agent paired");
            assert!(!*device.update_required.borrow(), "{error:?} sets no 426");
            assert_eq!(device.epoch(), 0, "{error:?} overtakes no retry");
        }

        let (device, tokens) = paired();
        device.handle_api_error(&ApiError::Unauthorized, &tokens);
        assert!(tokens.load().is_none(), "a 401 deletes the token");
        assert_eq!(device.epoch(), 1);

        let (device, tokens) = paired();
        device.handle_api_error(&ApiError::UpgradeRequired, &tokens);
        assert!(*device.update_required.borrow(), "a 426 sets the flag");
        assert_eq!(device.epoch(), 1);
    }
}
