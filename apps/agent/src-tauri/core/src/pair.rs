//! The pair use case (design.md § Pairing; AGS-05 to AGS-08, AGS-34, AGS-35; AD-050, AD-058).
//!
//! The loop pairs whenever the agent holds no token and no update is pending. It requests a code, shows it, claims it
//! every 2 s, stores the token on success and shows a new code on expiry, 410, a lost store write or a 401. Two codes
//! in a row that expire unused pause the loop until the player asks for "Get a new code". The rules are the domain's
//! `Pairing` aggregate; this module does the waiting, the I/O and the view.

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_domain::pairing::{ClaimNext, ClaimOutcome, CodeNext, Pairing};
use d2rmm_agent_domain::timings::{CLAIM_INTERVAL, UNREACHABLE_RETRY};
use tokio::sync::mpsc;
use tokio::time::Instant;
use tracing::Instrument;

use crate::device_state::DeviceState;
use crate::groups::PairingPorts;
use crate::messages::IssuedCode;
use crate::ports::{ApiError, ApiGateway, StoreError};
use crate::secret::Secret;
use crate::view::PairingView;

/// What the player can ask the pairing loop to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    /// "Get a new code": honoured only while the loop is paused.
    GetNewCode,
}

/// How one pairing attempt ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Finished {
    /// The token is stored and the agent is paired.
    Paired,
    /// A 426 interrupted the attempt; the loop waits for the update to install.
    Interrupted,
}

/// How a shown code ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shown {
    Paired,
    /// The code expired or was answered 410; the aggregate decides whether the loop pauses.
    Expired(CodeNext),
    /// Request a new code at once (401, lost store write, or a wait after 429 or an unreachable API).
    Restart,
    Interrupted,
}

/// Runs for the life of the agent: pairs while the agent holds no token, then waits for the next 401.
pub async fn run<G: ApiGateway + Send + Sync + 'static>(
    device: Arc<DeviceState>,
    ports: PairingPorts<G>,
    mut commands: mpsc::Receiver<Command>,
) {
    if ports.tokens.load().is_some() {
        device.set_paired(true);
    }
    loop {
        device.wait_until_allowed(unpaired_and_allowed).await;
        // An interrupted attempt starts again from a new code once the update gate opens.
        let _finished: Finished = pair_once(&device, &ports, &mut commands).await;
    }
}

fn unpaired_and_allowed(device: &DeviceState) -> bool {
    !device.is_paired() && device.pairing_allowed()
}

/// One pairing attempt: codes follow each other until one is claimed, the update gate closes, or the loop pauses.
async fn pair_once<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &PairingPorts<G>,
    commands: &mut mpsc::Receiver<Command>,
) -> Finished {
    let mut pairing = Pairing::new();
    loop {
        let Some(code) = obtain_code(device, ports).await else {
            return Finished::Interrupted;
        };
        match show_code(device, ports, code, &mut pairing).await {
            Shown::Paired => return Finished::Paired,
            Shown::Interrupted => return Finished::Interrupted,
            Shown::Restart | Shown::Expired(CodeNext::NewCode) => {}
            Shown::Expired(CodeNext::Pause) => {
                if !pause(device, commands).await {
                    return Finished::Interrupted;
                }
            }
        }
    }
}

/// Requests a code, waiting out unreachable and rate-limited answers. `None` when a 426 interrupts it.
async fn obtain_code<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &PairingPorts<G>,
) -> Option<IssuedCode> {
    loop {
        if !device.pairing_allowed() {
            return None;
        }
        device.hub.set_pairing(PairingView::Requesting);
        match ports.gateway.request_code().await {
            Ok(code) => return Some(code),
            Err(ApiError::RateLimited { retry_after }) => {
                device.hub.set_pairing(PairingView::RateLimited);
                let wait = Pairing::rate_limited(retry_after);
                if !device
                    .sleep_while_allowed(Instant::now() + wait, DeviceState::pairing_allowed)
                    .await
                {
                    return None;
                }
            }
            Err(ApiError::UpgradeRequired) => {
                device.on_upgrade_required(ports.tokens.as_ref());
                return None;
            }
            Err(_) => {
                device.hub.set_pairing(PairingView::Unreachable);
                if !device
                    .sleep_while_allowed(
                        Instant::now() + UNREACHABLE_RETRY,
                        DeviceState::pairing_allowed,
                    )
                    .await
                {
                    return None;
                }
            }
        }
    }
}

/// Shows one code and claims it until it is paired, expires or the attempt must restart.
async fn show_code<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &PairingPorts<G>,
    response: IssuedCode,
    pairing: &mut Pairing,
) -> Shown {
    let IssuedCode {
        code,
        expires_at,
        claim_secret: secret,
    } = response;
    let remaining = Pairing::remaining_until(expires_at, ports.clock.now_utc());
    let deadline = Instant::now() + remaining;

    let shown = code.as_str().to_string();
    pairing.show(code, expires_at);

    let mut shown_minutes = Pairing::minutes_left(remaining);
    device.hub.set_pairing(PairingView::ShowingCode {
        code: shown.clone(),
        minutes_left: shown_minutes,
    });
    let mut claim_at = Instant::now() + CLAIM_INTERVAL;

    loop {
        let now = Instant::now();
        if now >= deadline {
            return Shown::Expired(pairing.expired());
        }
        let minutes = Pairing::minutes_left(deadline - now);
        if minutes != shown_minutes {
            shown_minutes = minutes;
            device.hub.set_pairing(PairingView::ShowingCode {
                code: shown.clone(),
                minutes_left: minutes,
            });
        }

        let wake = claim_at.min(next_minute_change(deadline, now));
        if !device
            .sleep_while_allowed(wake, DeviceState::pairing_allowed)
            .await
        {
            return Shown::Interrupted;
        }
        if Instant::now() < claim_at {
            continue;
        }

        let span = tracing::info_span!("agent.pairing.claim");
        let started = Instant::now();
        let answer = ports.gateway.claim(&secret).instrument(span).await;
        let Some(outcome) = claim_outcome(&answer) else {
            device.on_upgrade_required(ports.tokens.as_ref());
            return Shown::Interrupted;
        };
        match (pairing.claim_result(outcome), answer) {
            (ClaimNext::Paired, Ok(token)) => return store_token(device, ports, &token),
            (ClaimNext::ClaimAfter(wait), _) => claim_at = started + wait,
            (ClaimNext::Expired(next), _) => return Shown::Expired(next),
            (ClaimNext::Restart, _) => {
                device.on_unauthorized(ports.tokens.as_ref());
                return Shown::Restart;
            }
            (ClaimNext::RestartAfter(wait), _) => {
                device.hub.set_pairing(match outcome {
                    ClaimOutcome::RateLimited { .. } => PairingView::RateLimited,
                    _ => PairingView::Unreachable,
                });
                if !device
                    .sleep_while_allowed(Instant::now() + wait, DeviceState::pairing_allowed)
                    .await
                {
                    return Shown::Interrupted;
                }
                return Shown::Restart;
            }
            // `Paired` follows only an issued token, which the arm above stores. An error answer never reaches it.
            (ClaimNext::Paired, Err(_)) => return Shown::Restart,
        }
    }
}

/// The aggregate's view of a claim answer. `None` for a `426`: the device owns that answer, not the pairing.
fn claim_outcome(answer: &Result<Secret, ApiError>) -> Option<ClaimOutcome> {
    match answer {
        Ok(_) => Some(ClaimOutcome::Claimed),
        Err(ApiError::Pending) => Some(ClaimOutcome::Pending),
        Err(ApiError::Gone) => Some(ClaimOutcome::Gone),
        Err(ApiError::Unauthorized) => Some(ClaimOutcome::Unauthorized),
        Err(ApiError::RateLimited { retry_after }) => Some(ClaimOutcome::RateLimited {
            retry_after: *retry_after,
        }),
        Err(ApiError::UpgradeRequired) => None,
        // A claim never answers a ready-check refusal; it counts as an unreachable answer if it ever did.
        Err(ApiError::Network | ApiError::Server | ApiError::Invalid | ApiError::CheckEnded) => {
            Some(ClaimOutcome::Unreachable)
        }
    }
}

/// Writes the token through the store. A refused write shows "Could not save the pairing" and asks for a new code.
fn store_token<G>(device: &DeviceState, ports: &PairingPorts<G>, token: &Secret) -> Shown {
    match ports.tokens.save(token) {
        Ok(()) => {
            device.set_paired(true);
            device.hub.set_pairing(PairingView::Paired);
            Shown::Paired
        }
        Err(StoreError) => {
            device.hub.set_pairing(PairingView::SaveFailed);
            Shown::Restart
        }
    }
}

/// Waits for the player's "Get a new code". Stale commands from before the pause are dropped first. `false` when a
/// 426 interrupts the pause.
async fn pause(device: &DeviceState, commands: &mut mpsc::Receiver<Command>) -> bool {
    while commands.try_recv().is_ok() {}
    device.hub.set_pairing(PairingView::Paused);
    let mut blocked = device.update_required.subscribe();
    loop {
        if !device.pairing_allowed() {
            return false;
        }
        tokio::select! {
            command = commands.recv() => match command {
                Some(Command::GetNewCode) => return true,
                // Every sender is gone: the agent is shutting down. Stay paused.
                None => std::future::pending::<()>().await,
            },
            _ = blocked.changed() => {}
        }
    }
}

/// The next instant at which `minutes_left` changes, given the deadline and `now` (before the deadline).
fn next_minute_change(deadline: Instant, now: Instant) -> Instant {
    let minutes = Pairing::minutes_left(deadline - now);
    if minutes <= 1 {
        deadline
    } else {
        deadline - Duration::from_secs(60 * u64::from(minutes - 1))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use chrono::{DateTime, TimeDelta, Utc};
    use d2rmm_agent_domain::pairing::ClaimOutcome;
    use tokio::sync::mpsc;

    use super::{Command, claim_outcome, run};
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink, fails_fast};
    use crate::groups::PairingPorts;
    use crate::messages::{IssuedCode, PairingCode};
    use crate::ports::{ApiError, PausedWallClock, TokenStore, WallClock};
    use crate::secret::Secret;
    use crate::view::PairingView;

    const START: &str = "2026-10-31T10:00:00Z";
    const CODE_LIFETIME_SECONDS: i64 = 300;

    fn start() -> DateTime<Utc> {
        START.parse().expect("a valid instant")
    }

    /// A code that expires five minutes after the test starts.
    fn issued(code: &str, claim: &str) -> IssuedCode {
        IssuedCode {
            code: PairingCode::new(code).expect("six digits"),
            expires_at: start() + TimeDelta::seconds(CODE_LIFETIME_SECONDS),
            claim_secret: Secret::new(claim),
        }
    }

    /// A code that expires `lifetime_seconds` after the test starts.
    fn issued_within(code: &str, claim: &str, lifetime_seconds: i64) -> IssuedCode {
        IssuedCode {
            code: PairingCode::new(code).expect("six digits"),
            expires_at: start() + TimeDelta::seconds(lifetime_seconds),
            claim_secret: Secret::new(claim),
        }
    }

    /// Claims that answer `Pending`, for a test that makes that many claims.
    fn pending_claims(count: usize) -> impl Iterator<Item = Result<Secret, ApiError>> {
        (0..count).map(|_| Err(ApiError::Pending))
    }

    /// The device and the pairing port group over the in-memory ports. The wall clock moves with paused tokio time.
    fn context(
        gateway: &Arc<FakeApiGateway>,
        tokens: &Arc<MemoryTokens>,
    ) -> (Arc<DeviceState>, PairingPorts<FakeApiGateway>) {
        let clock: Arc<dyn WallClock + Send + Sync> =
            Arc::new(PausedWallClock::starting_at(start()));
        let ports = PairingPorts {
            gateway: Arc::clone(gateway),
            tokens: tokens.clone(),
            clock,
        };
        (Arc::new(DeviceState::new(Arc::new(NullSink))), ports)
    }

    fn requests(gateway: &FakeApiGateway) -> usize {
        gateway
            .calls()
            .iter()
            .filter(|call| **call == Call::RequestCode)
            .count()
    }

    fn claims(gateway: &FakeApiGateway) -> usize {
        gateway
            .calls()
            .iter()
            .filter(|call| **call == Call::Claim)
            .count()
    }

    fn showing(code: &str, minutes_left: u8) -> PairingView {
        PairingView::ShowingCode {
            code: code.to_string(),
            minutes_left,
        }
    }

    #[test]
    fn every_claim_answer_maps_to_the_aggregate_outcome() {
        let token = Secret::new("claim-token");
        assert_eq!(claim_outcome(&Ok(token)), Some(ClaimOutcome::Claimed));
        assert_eq!(
            claim_outcome(&Err(ApiError::Pending)),
            Some(ClaimOutcome::Pending)
        );
        assert_eq!(
            claim_outcome(&Err(ApiError::Gone)),
            Some(ClaimOutcome::Gone)
        );
        assert_eq!(
            claim_outcome(&Err(ApiError::Unauthorized)),
            Some(ClaimOutcome::Unauthorized)
        );
        assert_eq!(
            claim_outcome(&Err(ApiError::RateLimited { retry_after: None })),
            Some(ClaimOutcome::RateLimited { retry_after: None })
        );
        for unreachable in [ApiError::Network, ApiError::Server, ApiError::Invalid] {
            assert_eq!(
                claim_outcome(&Err(unreachable)),
                Some(ClaimOutcome::Unreachable)
            );
        }
        assert_eq!(claim_outcome(&Err(ApiError::UpgradeRequired)), None);
    }

    #[test]
    fn pair_shows_code_then_stores_token() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([Ok(issued("123456", "claim-1"))]);
            gateway.script_claim([Err(ApiError::Pending), Ok(Secret::new("token-1"))]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(device.hub.snapshot().pairing, showing("123456", 5));

            tokio::time::sleep(Duration::from_secs(4)).await;
            assert_eq!(
                tokens.load().expect("the token is stored").expose(),
                "token-1"
            );
            assert_eq!(device.hub.snapshot().pairing, PairingView::Paired);
            assert_eq!(claims(&gateway), 2);
        });
    }

    #[test]
    fn pair_gone_shows_a_new_code() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([
                Ok(issued("123456", "claim-1")),
                Ok(issued("654321", "claim-2")),
            ]);
            gateway.script_claim([Err(ApiError::Gone), Err(ApiError::Pending)]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(3)).await;
            assert_eq!(device.hub.snapshot().pairing, showing("654321", 5));
            assert_eq!(requests(&gateway), 2);
            assert!(tokens.load().is_none(), "a gone code stores no token");
        });
    }

    #[test]
    fn pair_pauses_after_two_unused_codes() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([
                Ok(issued("123456", "claim-1")),
                Ok(issued("654321", "claim-2")),
            ]);
            gateway.script_claim([Err(ApiError::Gone), Err(ApiError::Gone)]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(5)).await;
            assert_eq!(device.hub.snapshot().pairing, PairingView::Paused);

            tokio::time::sleep(Duration::from_secs(600)).await;
            assert_eq!(device.hub.snapshot().pairing, PairingView::Paused);
            assert_eq!(requests(&gateway), 2, "no code is requested while paused");
        });
    }

    #[test]
    fn pair_resumes_on_get_new_code() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([
                Ok(issued("123456", "claim-1")),
                Ok(issued("654321", "claim-2")),
                Ok(issued("112233", "claim-3")),
            ]);
            gateway.script_claim([
                Err(ApiError::Gone),
                Err(ApiError::Gone),
                Err(ApiError::Pending),
            ]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (commands, receiver) = mpsc::channel::<Command>(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(5)).await;
            assert_eq!(device.hub.snapshot().pairing, PairingView::Paused);

            commands
                .send(Command::GetNewCode)
                .await
                .expect("the paused loop listens for the command");
            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(device.hub.snapshot().pairing, showing("112233", 5));
            assert_eq!(requests(&gateway), 3);
        });
    }

    #[test]
    fn rate_limited_request_waits_for_retry_after() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([
                Err(ApiError::RateLimited {
                    retry_after: Some(Duration::from_secs(30)),
                }),
                Ok(issued("123456", "claim-1")),
            ]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(device.hub.snapshot().pairing, PairingView::RateLimited);
            tokio::time::sleep(Duration::from_secs(28)).await;
            assert_eq!(requests(&gateway), 1, "no request before Retry-After");
            tokio::time::sleep(Duration::from_secs(2)).await;
            assert_eq!(
                requests(&gateway),
                2,
                "the request is repeated at Retry-After"
            );
        });
    }

    #[test]
    fn unreachable_request_waits_fifteen_seconds() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([Err(ApiError::Server), Ok(issued("123456", "claim-1"))]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(10)).await;
            assert_eq!(device.hub.snapshot().pairing, PairingView::Unreachable);
            assert_eq!(requests(&gateway), 1, "no request within the 15 s wait");
            tokio::time::sleep(Duration::from_secs(6)).await;
            assert_eq!(requests(&gateway), 2, "the request is repeated after 15 s");
        });
    }

    #[test]
    fn unused_codes_count_across_a_rate_limited_request() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([
                Ok(issued("123456", "claim-1")),
                Err(ApiError::RateLimited {
                    retry_after: Some(Duration::from_secs(1)),
                }),
                Ok(issued("654321", "claim-2")),
            ]);
            gateway.script_claim([Err(ApiError::Gone), Err(ApiError::Gone)]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(6)).await;
            assert_eq!(
                device.hub.snapshot().pairing,
                PairingView::Paused,
                "the second unused code pauses the loop, the wait between them included"
            );
            assert_eq!(requests(&gateway), 3, "no code is requested while paused");
        });
    }

    #[test]
    fn unused_codes_count_across_an_unreachable_request() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([
                Ok(issued("123456", "claim-1")),
                Err(ApiError::Server),
                Ok(issued("654321", "claim-2")),
            ]);
            gateway.script_claim([Err(ApiError::Gone), Err(ApiError::Gone)]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(20)).await;
            assert_eq!(
                device.hub.snapshot().pairing,
                PairingView::Paused,
                "the second unused code pauses the loop, the 15 s wait included"
            );
            assert_eq!(requests(&gateway), 3, "no code is requested while paused");
        });
    }

    #[test]
    fn unused_codes_count_across_a_rate_limited_claim() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([
                Ok(issued("123456", "claim-1")),
                Ok(issued("654321", "claim-2")),
                Ok(issued("112233", "claim-3")),
            ]);
            gateway.script_claim([
                Err(ApiError::Gone),
                Err(ApiError::RateLimited {
                    retry_after: Some(Duration::from_secs(1)),
                }),
                Err(ApiError::Gone),
            ]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(8)).await;
            assert_eq!(
                device.hub.snapshot().pairing,
                PairingView::Paused,
                "the second unused code pauses the loop, the claim's wait included"
            );
            assert_eq!(requests(&gateway), 3, "no code is requested while paused");
        });
    }

    #[test]
    fn rate_limited_claim_shows_rate_limited_and_waits_retry_after() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([
                Ok(issued("123456", "claim-1")),
                Ok(issued("654321", "claim-2")),
            ]);
            gateway.script_claim([
                Err(ApiError::RateLimited {
                    retry_after: Some(Duration::from_secs(30)),
                }),
                Err(ApiError::Server),
            ]);
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(3)).await;
            assert_eq!(
                device.hub.snapshot().pairing,
                PairingView::RateLimited,
                "a 429 on the claim shows rate limited"
            );
            tokio::time::sleep(Duration::from_secs(7)).await;
            assert_eq!(requests(&gateway), 1, "no request before Retry-After");
            tokio::time::sleep(Duration::from_secs(23)).await;
            assert_eq!(requests(&gateway), 2, "the next code is requested at 30 s");
            assert_eq!(device.hub.snapshot().pairing, showing("654321", 5));
            tokio::time::sleep(Duration::from_secs(2)).await;
            assert_eq!(
                device.hub.snapshot().pairing,
                PairingView::Unreachable,
                "a failed claim shows unreachable"
            );
        });
    }

    #[test]
    fn pending_claims_are_paced_two_seconds_apart() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_request_code([Ok(issued("123456", "claim-1"))]);
            gateway.script_claim(pending_claims(20));
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(9)).await;
            assert_eq!(claims(&gateway), 4, "the claims are at 2, 4, 6 and 8 s");
        });
    }

    #[test]
    fn countdown_moves_each_minute_and_claims_wait_for_the_minute() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            // Expires at 295 s, so the minute changes fall between the two-second claim ticks.
            gateway.script_request_code([Ok(issued_within("123456", "claim-1", 295))]);
            gateway.script_claim(pending_claims(130));
            let tokens = Arc::new(MemoryTokens::default());
            let (device, ports) = context(&gateway, &tokens);
            let (_commands, receiver) = mpsc::channel(8);
            tokio::spawn(run(Arc::clone(&device), ports, receiver));

            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(device.hub.snapshot().pairing, showing("123456", 5));

            tokio::time::sleep(Duration::from_millis(54_500)).await;
            assert_eq!(
                device.hub.snapshot().pairing,
                showing("123456", 4),
                "the count moves to 4 at 55 s"
            );
            assert_eq!(
                claims(&gateway),
                27,
                "no claim is made between minute changes"
            );

            tokio::time::sleep(Duration::from_secs(60)).await;
            assert_eq!(device.hub.snapshot().pairing, showing("123456", 3));
            tokio::time::sleep(Duration::from_secs(60)).await;
            assert_eq!(device.hub.snapshot().pairing, showing("123456", 2));
            tokio::time::sleep(Duration::from_secs(60)).await;
            assert_eq!(
                device.hub.snapshot().pairing,
                showing("123456", 1),
                "the last minute shows 1"
            );
        });
    }
}
