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

use crate::context::Context;
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
    ctx: Arc<Context<G>>,
    mut commands: mpsc::Receiver<Command>,
) {
    if ctx.tokens.load().is_some() {
        ctx.paired.send_replace(true);
    }
    loop {
        ctx.wait_until_allowed(unpaired_and_allowed).await;
        // An interrupted attempt starts again from a new code once the update gate opens.
        let _finished: Finished = pair_once(&ctx, &mut commands).await;
    }
}

fn unpaired_and_allowed<G>(ctx: &Context<G>) -> bool {
    !*ctx.paired.borrow() && ctx.pairing_allowed()
}

/// One pairing attempt: codes follow each other until one is claimed, the update gate closes, or the loop pauses.
async fn pair_once<G: ApiGateway + Send + Sync>(
    ctx: &Context<G>,
    commands: &mut mpsc::Receiver<Command>,
) -> Finished {
    let mut pairing = Pairing::new();
    loop {
        let Some(code) = obtain_code(ctx).await else {
            return Finished::Interrupted;
        };
        match show_code(ctx, code, &mut pairing).await {
            Shown::Paired => return Finished::Paired,
            Shown::Interrupted => return Finished::Interrupted,
            Shown::Restart | Shown::Expired(CodeNext::NewCode) => {}
            Shown::Expired(CodeNext::Pause) => {
                if !pause(ctx, commands).await {
                    return Finished::Interrupted;
                }
            }
        }
    }
}

/// Requests a code, waiting out unreachable and rate-limited answers. `None` when a 426 interrupts it.
async fn obtain_code<G: ApiGateway + Send + Sync>(ctx: &Context<G>) -> Option<IssuedCode> {
    loop {
        if !ctx.pairing_allowed() {
            return None;
        }
        ctx.hub.set_pairing(PairingView::Requesting);
        match ctx.gateway.request_code().await {
            Ok(code) => return Some(code),
            Err(ApiError::RateLimited { retry_after }) => {
                ctx.hub.set_pairing(PairingView::RateLimited);
                let wait = Pairing::rate_limited(retry_after);
                if !ctx
                    .sleep_while_allowed(Instant::now() + wait, Context::pairing_allowed)
                    .await
                {
                    return None;
                }
            }
            Err(ApiError::UpgradeRequired) => {
                ctx.on_upgrade_required();
                return None;
            }
            Err(_) => {
                ctx.hub.set_pairing(PairingView::Unreachable);
                if !ctx
                    .sleep_while_allowed(
                        Instant::now() + UNREACHABLE_RETRY,
                        Context::pairing_allowed,
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
    ctx: &Context<G>,
    response: IssuedCode,
    pairing: &mut Pairing,
) -> Shown {
    let IssuedCode {
        code,
        expires_at,
        claim_secret: secret,
    } = response;
    let remaining = Pairing::remaining_until(expires_at, ctx.clock.now_utc());
    let deadline = Instant::now() + remaining;

    let shown = code.as_str().to_string();
    pairing.show(code, expires_at);

    let mut shown_minutes = Pairing::minutes_left(remaining);
    ctx.hub.set_pairing(PairingView::ShowingCode {
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
            ctx.hub.set_pairing(PairingView::ShowingCode {
                code: shown.clone(),
                minutes_left: minutes,
            });
        }

        let wake = claim_at.min(next_minute_change(deadline, now));
        if !ctx
            .sleep_while_allowed(wake, Context::pairing_allowed)
            .await
        {
            return Shown::Interrupted;
        }
        if Instant::now() < claim_at {
            continue;
        }

        let span = tracing::info_span!("agent.pairing.claim");
        let started = Instant::now();
        let answer = ctx.gateway.claim(&secret).instrument(span).await;
        let Some(outcome) = claim_outcome(&answer) else {
            ctx.on_upgrade_required();
            return Shown::Interrupted;
        };
        match (pairing.claim_result(outcome), answer) {
            (ClaimNext::Paired, Ok(token)) => return store_token(ctx, &token),
            (ClaimNext::ClaimAfter(wait), _) => claim_at = started + wait,
            (ClaimNext::Expired(next), _) => return Shown::Expired(next),
            (ClaimNext::Restart, _) => {
                ctx.on_unauthorized();
                return Shown::Restart;
            }
            (ClaimNext::RestartAfter(wait), _) => {
                ctx.hub.set_pairing(match outcome {
                    ClaimOutcome::RateLimited { .. } => PairingView::RateLimited,
                    _ => PairingView::Unreachable,
                });
                if !ctx
                    .sleep_while_allowed(Instant::now() + wait, Context::pairing_allowed)
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
        Err(ApiError::Network | ApiError::Server | ApiError::Invalid) => {
            Some(ClaimOutcome::Unreachable)
        }
    }
}

/// Writes the token through the store. A refused write shows "Could not save the pairing" and asks for a new code.
fn store_token<G>(ctx: &Context<G>, token: &Secret) -> Shown {
    match ctx.tokens.save(token) {
        Ok(()) => {
            ctx.paired.send_replace(true);
            ctx.hub.set_pairing(PairingView::Paired);
            Shown::Paired
        }
        Err(StoreError) => {
            ctx.hub.set_pairing(PairingView::SaveFailed);
            Shown::Restart
        }
    }
}

/// Waits for the player's "Get a new code". Stale commands from before the pause are dropped first. `false` when a
/// 426 interrupts the pause.
async fn pause<G: Send + Sync>(ctx: &Context<G>, commands: &mut mpsc::Receiver<Command>) -> bool {
    while commands.try_recv().is_ok() {}
    ctx.hub.set_pairing(PairingView::Paused);
    let mut blocked = ctx.update_required.subscribe();
    loop {
        if !ctx.pairing_allowed() {
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
    use d2rmm_agent_domain::pairing::ClaimOutcome;

    use super::claim_outcome;
    use crate::ports::ApiError;
    use crate::secret::Secret;

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
}
