//! The remote configuration loop (remote-config RCF-04, RCF-06, RCF-08; ADR 010). Once the agent is paired, and at start, then
//! every six hours, it asks its own API for the configuration with a conditional request, turns the body into the effective
//! configuration through the domain's `from_wire` (clamped, field by field, version rule) and publishes it. A failed fetch keeps
//! what the agent holds and backs off like the other loops. The last good body is kept on the PC and read back through the same
//! rules at the next start, so an API that is gone changes nothing. The body is data: nothing in it is executed.

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_domain::remote_config::{Effective, Verdict, from_wire};
use d2rmm_agent_domain::timings::{RECONNECT_MAX, RECONNECT_MIN};
use tokio::time::Instant;

use crate::device_state::DeviceState;
use crate::ports::{ApiError, ConfigGateway, ConfigReader, ConfigStore, Fetched, TokenStore};

/// The interval between fetches (RCF-04).
pub const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// The ports the configuration loop uses (AHM-17): exactly four.
pub struct ConfigPorts<G> {
    pub gateway: Arc<G>,
    pub tokens: Arc<dyn TokenStore + Send + Sync>,
    pub store: Arc<dyn ConfigStore + Send + Sync>,
    pub reader: Arc<dyn ConfigReader + Send + Sync>,
}

/// How the last fetch ended: the fixed words of `config.outcome` (RCF-11).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Applied,
    Unchanged,
    Invalid,
    Stale,
    Unreachable,
}

impl Outcome {
    pub const fn word(self) -> &'static str {
        match self {
            Self::Applied => "applied",
            Self::Unchanged => "unchanged",
            Self::Invalid => "invalid",
            Self::Stale => "stale",
            Self::Unreachable => "unreachable",
        }
    }
}

/// What the last fetch came to, with a count so a watcher sees every one, also two in a row with the same outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConfigFetch {
    pub count: u64,
    pub outcome: Outcome,
}

impl Default for ConfigFetch {
    fn default() -> Self {
        Self {
            count: 0,
            outcome: Outcome::Unchanged,
        }
    }
}

/// Loads the last good body, if any, and applies it as a version-0 holder would (RCF-06). A body that fails its rules is
/// deleted, and the defaults apply. Called once at start, before the first fetch.
pub fn load_stored(device: &DeviceState, ports: &ConfigPorts<impl Sized>) {
    let Some(body) = ports.store.load() else {
        return;
    };
    let wire = ports.reader.read(&body);
    match from_wire(wire.as_ref(), 0) {
        Verdict::Applied(effective) => {
            device.config.send_replace(*effective);
        }
        Verdict::Unchanged | Verdict::Stale | Verdict::Invalid => ports.store.delete(),
    }
}

/// Fetches for the life of the agent, whenever it is paired and not waiting for an update. `every` is the interval between
/// fetches (`CHECK_EVERY` in the product; the composition root may add a jitter).
pub async fn run<G: ConfigGateway + Send + Sync + 'static>(
    device: Arc<DeviceState>,
    ports: ConfigPorts<G>,
    every: Duration,
) {
    load_stored(&device, &ports);
    let mut etag: Option<String> = None;
    let mut backoff = RECONNECT_MIN;
    loop {
        device.wait_until_allowed(DeviceState::api_allowed).await;
        let started = Instant::now();
        let outcome = fetch_once(&device, &ports, &mut etag).await;
        publish(&device, outcome);
        let wait = if outcome == Outcome::Unreachable {
            let wait = backoff;
            backoff = (backoff * 2).min(RECONNECT_MAX);
            wait
        } else {
            backoff = RECONNECT_MIN;
            every
        };
        // A 401 or a 426 interrupts the sleep; the loop then waits until the API loops may run again and fetches at once.
        device
            .sleep_while_allowed(started + wait, DeviceState::api_allowed)
            .await;
    }
}

fn publish(device: &DeviceState, outcome: Outcome) {
    device.config_fetch.send_modify(|fetch| {
        fetch.count += 1;
        fetch.outcome = outcome;
    });
}

/// One request and what it did to the configuration the agent runs.
pub async fn fetch_once<G: ConfigGateway + Send + Sync>(
    device: &DeviceState,
    ports: &ConfigPorts<G>,
    etag: &mut Option<String>,
) -> Outcome {
    let Some(token) = ports.tokens.load() else {
        return Outcome::Unreachable;
    };
    match ports.gateway.fetch_config(&token, etag.as_deref()).await {
        Fetched::NotModified | Fetched::Absent => Outcome::Unchanged,
        Fetched::Failed(error) => {
            if matches!(error, ApiError::Unauthorized | ApiError::UpgradeRequired) {
                device.handle_api_error(&error, &*ports.tokens);
            }
            Outcome::Unreachable
        }
        Fetched::Body {
            bytes,
            etag: served,
        } => {
            let held = device.config.borrow().version;
            let wire = ports.reader.read(&bytes);
            match from_wire(wire.as_ref(), held) {
                Verdict::Applied(effective) => {
                    apply(device, ports, *effective, &bytes);
                    *etag = served;
                    Outcome::Applied
                }
                Verdict::Unchanged => {
                    *etag = served;
                    Outcome::Unchanged
                }
                Verdict::Stale => Outcome::Stale,
                Verdict::Invalid => Outcome::Invalid,
            }
        }
    }
}

/// Runs on the new configuration from the next look of each loop (RCF-08) and keeps the body for the next start (RCF-06). A
/// store that refuses the write changes nothing about what runs now.
fn apply<G>(device: &DeviceState, ports: &ConfigPorts<G>, effective: Effective, body: &[u8]) {
    let _ = ports.store.save(body);
    device.config.send_replace(effective);
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use d2rmm_agent_domain::remote_config::{Effective, Wire};

    use super::{CHECK_EVERY, ConfigFetch, ConfigPorts, Outcome, fetch_once, load_stored, run};
    use crate::device_state::DeviceState;
    use crate::fakes::{CALL_LIMIT, MemoryTokens, NullSink, fails_fast, trip_bound};
    use crate::ports::{
        ApiError, ConfigGateway, ConfigReader, ConfigStore, Fetched, StoreError, TokenStore,
    };
    use crate::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    /// A body of the fakes: `version:probeEvery`, or anything else for "not a document".
    fn body(version: u32, probe_every: u32) -> Vec<u8> {
        format!("{version}:{probe_every}").into_bytes()
    }

    struct FakeReader;

    impl ConfigReader for FakeReader {
        fn read(&self, body: &[u8]) -> Option<Wire> {
            let text = std::str::from_utf8(body).ok()?;
            let (version, probe) = text.split_once(':')?;
            Some(Wire {
                version: version.parse().ok(),
                probe_every: probe.parse().ok(),
                ..Wire::default()
            })
        }
    }

    /// A gateway that answers as scripted and records the tag each request carried.
    #[derive(Default)]
    struct FakeGateway {
        answers: Mutex<VecDeque<Fetched>>,
        asked: Mutex<Vec<Option<String>>>,
    }

    impl FakeGateway {
        fn script(&self, answers: impl IntoIterator<Item = Fetched>) {
            self.answers.lock().expect("answers").extend(answers);
        }

        fn asked(&self) -> Vec<Option<String>> {
            self.asked.lock().expect("asked").clone()
        }
    }

    impl ConfigGateway for FakeGateway {
        async fn fetch_config(&self, _token: &Secret, held_etag: Option<&str>) -> Fetched {
            let mut asked = self.asked.lock().expect("asked");
            if asked.len() > CALL_LIMIT {
                trip_bound("the config gateway", CALL_LIMIT);
            }
            asked.push(held_etag.map(str::to_string));
            self.answers
                .lock()
                .expect("answers")
                .pop_front()
                .unwrap_or(Fetched::Failed(ApiError::Network))
        }
    }

    #[derive(Default)]
    struct MemoryStore {
        body: Mutex<Option<Vec<u8>>>,
        deleted: Mutex<usize>,
        refuses: bool,
    }

    impl ConfigStore for MemoryStore {
        fn load(&self) -> Option<Vec<u8>> {
            self.body.lock().expect("body").clone()
        }

        fn save(&self, body: &[u8]) -> Result<(), StoreError> {
            if self.refuses {
                return Err(StoreError);
            }
            *self.body.lock().expect("body") = Some(body.to_vec());
            Ok(())
        }

        fn delete(&self) {
            *self.deleted.lock().expect("deleted") += 1;
            *self.body.lock().expect("body") = None;
        }
    }

    struct Rig {
        device: Arc<DeviceState>,
        gateway: Arc<FakeGateway>,
        store: Arc<MemoryStore>,
        ports: ConfigPorts<FakeGateway>,
    }

    fn rig(paired: bool, store: MemoryStore) -> Rig {
        let tokens = MemoryTokens::default();
        if paired {
            tokens.save(&Secret::new(TOKEN)).expect("a token");
        }
        let device = Arc::new(DeviceState::new(Arc::new(NullSink)));
        device.set_paired(paired);
        let gateway = Arc::new(FakeGateway::default());
        let store = Arc::new(store);
        let ports = ConfigPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::new(tokens),
            store: Arc::clone(&store) as Arc<dyn ConfigStore + Send + Sync>,
            reader: Arc::new(FakeReader),
        };
        Rig {
            device,
            gateway,
            store,
            ports,
        }
    }

    fn served(version: u32, probe_every: u32, etag: &str) -> Fetched {
        Fetched::Body {
            bytes: body(version, probe_every),
            etag: Some(etag.to_string()),
        }
    }

    fn running(device: &DeviceState) -> Effective {
        device.config.borrow().clone()
    }

    #[tokio::test]
    async fn a_newer_body_is_applied_and_kept() {
        let rig = rig(true, MemoryStore::default());
        rig.gateway.script([served(5, 30, "\"a\"")]);
        let mut etag = None;

        let outcome = fetch_once(&rig.device, &rig.ports, &mut etag).await;

        assert_eq!(outcome, Outcome::Applied);
        assert_eq!(running(&rig.device).version, 5);
        assert_eq!(running(&rig.device).cadence.probe_every, 30);
        assert_eq!(rig.store.load(), Some(body(5, 30)));
        assert_eq!(etag.as_deref(), Some("\"a\""));
    }

    #[tokio::test]
    async fn the_next_request_names_the_tag_it_holds_and_a_304_changes_nothing() {
        let rig = rig(true, MemoryStore::default());
        rig.gateway
            .script([served(5, 30, "\"a\""), Fetched::NotModified]);
        let mut etag = None;
        fetch_once(&rig.device, &rig.ports, &mut etag).await;

        let outcome = fetch_once(&rig.device, &rig.ports, &mut etag).await;

        assert_eq!(outcome, Outcome::Unchanged);
        assert_eq!(rig.gateway.asked(), vec![None, Some("\"a\"".to_string())]);
        assert_eq!(running(&rig.device).version, 5);
    }

    #[tokio::test]
    async fn an_api_that_serves_no_configuration_changes_nothing() {
        let rig = rig(true, MemoryStore::default());
        rig.gateway.script([Fetched::Absent]);

        let outcome = fetch_once(&rig.device, &rig.ports, &mut None).await;

        assert_eq!(outcome, Outcome::Unchanged);
        assert_eq!(running(&rig.device), Effective::built_in());
        assert_eq!(rig.store.load(), None);
    }

    #[tokio::test]
    async fn the_same_version_changes_nothing_and_writes_nothing() {
        let rig = rig(true, MemoryStore::default());
        rig.gateway
            .script([served(5, 30, "\"a\""), served(5, 90, "\"b\"")]);
        let mut etag = None;
        fetch_once(&rig.device, &rig.ports, &mut etag).await;

        let outcome = fetch_once(&rig.device, &rig.ports, &mut etag).await;

        assert_eq!(outcome, Outcome::Unchanged);
        assert_eq!(running(&rig.device).cadence.probe_every, 30);
        assert_eq!(rig.store.load(), Some(body(5, 30)));
    }

    #[tokio::test]
    async fn an_older_version_keeps_what_the_agent_holds() {
        let rig = rig(true, MemoryStore::default());
        rig.gateway
            .script([served(5, 30, "\"a\""), served(4, 90, "\"b\"")]);
        let mut etag = None;
        fetch_once(&rig.device, &rig.ports, &mut etag).await;

        let outcome = fetch_once(&rig.device, &rig.ports, &mut etag).await;

        assert_eq!(outcome, Outcome::Stale);
        assert_eq!(running(&rig.device).version, 5);
        assert_eq!(running(&rig.device).cadence.probe_every, 30);
        assert_eq!(rig.store.load(), Some(body(5, 30)));
        assert_eq!(etag.as_deref(), Some("\"a\""), "the tag of what is held");
    }

    #[tokio::test]
    async fn a_broken_body_keeps_the_last_good_one() {
        let rig = rig(true, MemoryStore::default());
        rig.gateway.script([
            served(5, 30, "\"a\""),
            Fetched::Body {
                bytes: b"not a document".to_vec(),
                etag: Some("\"b\"".into()),
            },
        ]);
        let mut etag = None;
        fetch_once(&rig.device, &rig.ports, &mut etag).await;

        let outcome = fetch_once(&rig.device, &rig.ports, &mut etag).await;

        assert_eq!(outcome, Outcome::Invalid);
        assert_eq!(running(&rig.device).version, 5);
        assert_eq!(rig.store.load(), Some(body(5, 30)));
        assert_eq!(etag.as_deref(), Some("\"a\""));
    }

    #[tokio::test]
    async fn a_body_without_a_version_is_invalid() {
        let rig = rig(true, MemoryStore::default());
        rig.gateway.script([Fetched::Body {
            bytes: b"x:30".to_vec(),
            etag: None,
        }]);
        let outcome = fetch_once(&rig.device, &rig.ports, &mut None).await;
        assert_eq!(outcome, Outcome::Invalid);
        assert_eq!(running(&rig.device), Effective::built_in());
        assert_eq!(rig.store.load(), None);
    }

    #[tokio::test]
    async fn an_unreachable_api_keeps_what_the_agent_holds() {
        for error in [ApiError::Network, ApiError::Server, ApiError::Invalid] {
            let rig = rig(true, MemoryStore::default());
            rig.gateway
                .script([served(5, 30, "\"a\""), Fetched::Failed(error)]);
            let mut etag = None;
            fetch_once(&rig.device, &rig.ports, &mut etag).await;

            let outcome = fetch_once(&rig.device, &rig.ports, &mut etag).await;

            assert_eq!(outcome, Outcome::Unreachable);
            assert_eq!(running(&rig.device).version, 5);
        }
    }

    #[tokio::test]
    async fn a_401_unpairs_the_device_like_every_other_request() {
        let rig = rig(true, MemoryStore::default());
        rig.gateway
            .script([Fetched::Failed(ApiError::Unauthorized)]);

        let outcome = fetch_once(&rig.device, &rig.ports, &mut None).await;

        assert_eq!(outcome, Outcome::Unreachable);
        assert!(!rig.device.is_paired());
    }

    #[tokio::test]
    async fn a_426_stops_the_api_loops_until_an_update_installs() {
        let rig = rig(true, MemoryStore::default());
        rig.gateway
            .script([Fetched::Failed(ApiError::UpgradeRequired)]);

        fetch_once(&rig.device, &rig.ports, &mut None).await;

        assert!(!rig.device.api_allowed());
    }

    #[tokio::test]
    async fn a_store_that_refuses_the_write_still_applies_the_configuration() {
        let rig = rig(
            true,
            MemoryStore {
                refuses: true,
                ..MemoryStore::default()
            },
        );
        rig.gateway.script([served(5, 30, "\"a\"")]);

        let outcome = fetch_once(&rig.device, &rig.ports, &mut None).await;

        assert_eq!(outcome, Outcome::Applied);
        assert_eq!(running(&rig.device).cadence.probe_every, 30);
    }

    #[tokio::test]
    async fn without_a_token_nothing_is_requested() {
        let rig = rig(false, MemoryStore::default());
        rig.gateway.script([served(5, 30, "\"a\"")]);

        let outcome = fetch_once(&rig.device, &rig.ports, &mut None).await;

        assert_eq!(outcome, Outcome::Unreachable);
        assert!(rig.gateway.asked().is_empty());
    }

    #[test]
    fn a_restart_with_the_api_gone_runs_the_last_good_body() {
        let rig = rig(
            true,
            MemoryStore {
                body: Mutex::new(Some(body(5, 30))),
                ..MemoryStore::default()
            },
        );

        load_stored(&rig.device, &rig.ports);

        assert_eq!(running(&rig.device).version, 5);
        assert_eq!(running(&rig.device).cadence.probe_every, 30);
        assert!(rig.gateway.asked().is_empty());
    }

    #[test]
    fn a_stored_body_that_fails_its_rules_is_deleted_and_the_defaults_apply() {
        for corrupted in [
            b"garbage".to_vec(),
            b"0:30".to_vec(),
            b"1.5:30".to_vec(),
            Vec::new(),
        ] {
            let rig = rig(
                true,
                MemoryStore {
                    body: Mutex::new(Some(corrupted)),
                    ..MemoryStore::default()
                },
            );

            load_stored(&rig.device, &rig.ports);

            assert_eq!(running(&rig.device), Effective::built_in());
            assert_eq!(rig.store.load(), None, "the file is deleted");
            assert_eq!(*rig.store.deleted.lock().expect("deleted"), 1);
        }
    }

    #[test]
    fn no_stored_body_leaves_the_defaults_and_deletes_nothing() {
        let rig = rig(true, MemoryStore::default());
        load_stored(&rig.device, &rig.ports);
        assert_eq!(running(&rig.device), Effective::built_in());
        assert_eq!(*rig.store.deleted.lock().expect("deleted"), 0);
    }

    #[test]
    fn the_outcome_words_are_fixed() {
        assert_eq!(Outcome::Applied.word(), "applied");
        assert_eq!(Outcome::Unchanged.word(), "unchanged");
        assert_eq!(Outcome::Invalid.word(), "invalid");
        assert_eq!(Outcome::Stale.word(), "stale");
        assert_eq!(Outcome::Unreachable.word(), "unreachable");
    }

    #[test]
    fn the_check_interval_is_six_hours() {
        assert_eq!(CHECK_EVERY, Duration::from_secs(21_600));
    }

    #[test]
    fn each_fetch_is_counted_so_a_watcher_sees_two_alike_in_a_row() {
        let rig = rig(true, MemoryStore::default());
        let fetch = ConfigFetch::default();
        assert_eq!(fetch.count, 0);
        super::publish(&rig.device, Outcome::Unchanged);
        super::publish(&rig.device, Outcome::Unchanged);
        let seen = *rig.device.config_fetch.borrow();
        assert_eq!(seen.count, 2);
        assert_eq!(seen.outcome, Outcome::Unchanged);
    }

    /// The loop fetches at start, then every six hours, and backs off from 1 s to 60 s while the API does not answer.
    #[test]
    fn the_loop_fetches_at_start_and_every_six_hours() {
        fails_fast(|| async {
            let rig = rig(true, MemoryStore::default());
            rig.gateway.script([
                served(5, 30, "\"a\""),
                Fetched::NotModified,
                Fetched::NotModified,
            ]);
            tokio::spawn(run(Arc::clone(&rig.device), rig.ports, CHECK_EVERY));

            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(rig.gateway.asked().len(), 1, "a fetch at start");
            assert_eq!(running(&rig.device).version, 5);

            tokio::time::sleep(CHECK_EVERY - Duration::from_secs(10)).await;
            assert_eq!(rig.gateway.asked().len(), 1, "none before six hours");
            tokio::time::sleep(Duration::from_secs(20)).await;
            assert_eq!(rig.gateway.asked().len(), 2, "one at six hours");
            assert_eq!(
                rig.gateway.asked()[1].as_deref(),
                Some("\"a\""),
                "a conditional request"
            );
            tokio::time::sleep(CHECK_EVERY).await;
            assert_eq!(rig.gateway.asked().len(), 3, "one at twelve hours");
        });
    }

    #[test]
    fn the_loop_backs_off_from_one_second_to_a_minute_while_the_api_does_not_answer() {
        fails_fast(|| async {
            let rig = rig(true, MemoryStore::default());
            tokio::spawn(run(Arc::clone(&rig.device), rig.ports, CHECK_EVERY));

            // Fetches at 0, 1, 3, 7, 15, 31, 63 s (each wait doubles), then every 60 s. Each check stands half a second
            // after the fetch it counts.
            let mut now = Duration::ZERO;
            for (fetch_at, count) in [(0, 1), (1, 2), (3, 3), (7, 4), (15, 5), (31, 6), (63, 7)] {
                let check_at = Duration::from_millis(fetch_at * 1_000 + 500);
                tokio::time::sleep(check_at - now).await;
                now = check_at;
                assert_eq!(rig.gateway.asked().len(), count, "at {fetch_at} s");
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
            assert_eq!(
                rig.gateway.asked().len(),
                8,
                "the wait stops growing at 60 s"
            );
            tokio::time::sleep(Duration::from_secs(60)).await;
            assert_eq!(rig.gateway.asked().len(), 9);
        });
    }

    #[test]
    fn a_fetch_after_a_failure_is_the_regular_interval_again() {
        fails_fast(|| async {
            let rig = rig(true, MemoryStore::default());
            rig.gateway.script([
                Fetched::Failed(ApiError::Network),
                served(5, 30, "\"a\""),
                Fetched::NotModified,
            ]);
            tokio::spawn(run(Arc::clone(&rig.device), rig.ports, CHECK_EVERY));

            tokio::time::sleep(Duration::from_millis(1_500)).await;
            assert_eq!(rig.gateway.asked().len(), 2, "the retry after one second");
            assert_eq!(running(&rig.device).version, 5);
            tokio::time::sleep(Duration::from_secs(3_600)).await;
            assert_eq!(
                rig.gateway.asked().len(),
                2,
                "back on the six-hour schedule"
            );
        });
    }

    #[test]
    fn the_loop_does_not_fetch_while_unpaired_and_fetches_once_paired() {
        fails_fast(|| async {
            let rig = rig(false, MemoryStore::default());
            rig.gateway.script([served(5, 30, "\"a\"")]);
            let tokens = Arc::clone(&rig.ports.tokens);
            tokio::spawn(run(Arc::clone(&rig.device), rig.ports, CHECK_EVERY));

            tokio::time::sleep(Duration::from_secs(120)).await;
            assert!(rig.gateway.asked().is_empty(), "nothing before pairing");

            tokens.save(&Secret::new(TOKEN)).expect("a token");
            rig.device.set_paired(true);
            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(rig.gateway.asked().len(), 1, "a fetch after pairing");
            assert_eq!(running(&rig.device).version, 5);
        });
    }

    #[test]
    fn the_loop_applies_the_stored_body_before_the_first_fetch() {
        fails_fast(|| async {
            let rig = rig(
                false,
                MemoryStore {
                    body: Mutex::new(Some(body(5, 30))),
                    ..MemoryStore::default()
                },
            );
            tokio::spawn(run(Arc::clone(&rig.device), rig.ports, CHECK_EVERY));

            tokio::time::sleep(Duration::from_millis(100)).await;
            assert_eq!(
                running(&rig.device).version,
                5,
                "before any fetch, unpaired"
            );
            assert!(rig.gateway.asked().is_empty());
        });
    }
}
