//! The pairing state machine (design.md § Pairing; AGS-05 to AGS-08, AGS-34, AGS-35; AD-050, AD-058).
//!
//! The loop pairs whenever the agent holds no token and no update is pending. It requests a code, shows it, claims it
//! every 2 s, stores the token on success and shows a new code on expiry, 410, a lost store write or a 401. Two codes
//! in a row that expire unused pause the loop until the player asks for "Get a new code".

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::mpsc;
use tokio::time::Instant;
use tracing::Instrument;

use crate::api_client::ApiError;
use crate::context::Context;
use crate::contracts::generated::PairingCodeResponse;
use crate::ports::StoreError;
use crate::secret::Secret;
use crate::view::PairingView;

/// The interval between two claims of a shown code (AD-050).
pub const CLAIM_INTERVAL: Duration = Duration::from_secs(2);
/// The retry interval of a code request that cannot reach the API (design.md § Error Handling).
pub const UNREACHABLE_RETRY: Duration = Duration::from_secs(15);
/// The wait after a 429 on the code request when the response has no `Retry-After` (AD-058).
pub const RATE_LIMIT_DEFAULT: Duration = Duration::from_secs(60 * 60);
/// Consecutive codes that expire unused before the loop pauses (AD-058).
pub const UNUSED_LIMIT: u8 = 2;

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
    /// The code expired or was answered 410; the unused count went up.
    Expired,
    /// Request a new code at once (401, lost store write, or a wait after 429 or an unreachable API).
    Restart,
    Interrupted,
}

/// Runs for the life of the agent: pairs while the agent holds no token, then waits for the next 401.
pub async fn run(ctx: Arc<Context>, mut commands: mpsc::Receiver<Command>) {
    if ctx.tokens.load().is_some() {
        ctx.paired.send_replace(true);
    }
    loop {
        ctx.wait_until_allowed(unpaired_and_allowed).await;
        // An interrupted attempt starts again from a new code once the update gate opens.
        let _finished: Finished = pair_once(&ctx, &mut commands).await;
    }
}

fn unpaired_and_allowed(ctx: &Context) -> bool {
    !*ctx.paired.borrow() && ctx.pairing_allowed()
}

/// One pairing attempt: codes follow each other until one is claimed, the update gate closes, or the loop pauses.
async fn pair_once(ctx: &Context, commands: &mut mpsc::Receiver<Command>) -> Finished {
    let mut unused: u8 = 0;
    loop {
        let Some(code) = obtain_code(ctx).await else {
            return Finished::Interrupted;
        };
        match show_code(ctx, code, &mut unused).await {
            Shown::Paired => return Finished::Paired,
            Shown::Interrupted => return Finished::Interrupted,
            Shown::Expired | Shown::Restart => {}
        }
        if unused >= UNUSED_LIMIT {
            if !pause(ctx, commands).await {
                return Finished::Interrupted;
            }
            unused = 0;
        }
    }
}

/// Requests a code, waiting out unreachable and rate-limited answers. `None` when a 426 interrupts it.
async fn obtain_code(ctx: &Context) -> Option<PairingCodeResponse> {
    loop {
        if !ctx.pairing_allowed() {
            return None;
        }
        ctx.hub.set_pairing(PairingView::Requesting);
        match ctx.api.request_code().await {
            Ok(code) => return Some(code),
            Err(ApiError::RateLimited { retry_after }) => {
                ctx.hub.set_pairing(PairingView::RateLimited);
                let wait = retry_after.unwrap_or(RATE_LIMIT_DEFAULT);
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
async fn show_code(ctx: &Context, response: PairingCodeResponse, unused: &mut u8) -> Shown {
    let code = String::from(response.code);
    let secret = response.claim_secret;
    let remaining = remaining_until(response.expires_at, ctx.clock.now_utc());
    let deadline = Instant::now() + remaining;

    let mut shown_minutes = minutes_left(remaining);
    ctx.hub.set_pairing(PairingView::ShowingCode {
        code: code.clone(),
        minutes_left: shown_minutes,
    });
    let mut claim_at = Instant::now() + CLAIM_INTERVAL;

    loop {
        let now = Instant::now();
        if now >= deadline {
            *unused = unused.saturating_add(1);
            return Shown::Expired;
        }
        let minutes = minutes_left(deadline - now);
        if minutes != shown_minutes {
            shown_minutes = minutes;
            ctx.hub.set_pairing(PairingView::ShowingCode {
                code: code.clone(),
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
        let outcome = ctx.api.claim(&secret).instrument(span).await;
        claim_at = started + CLAIM_INTERVAL;
        match outcome {
            Ok(token) => return store_token(ctx, &token),
            Err(ApiError::Pending) => {}
            Err(ApiError::Gone) => {
                *unused = unused.saturating_add(1);
                return Shown::Expired;
            }
            Err(ApiError::Unauthorized) => {
                ctx.on_unauthorized();
                *unused = 0;
                return Shown::Restart;
            }
            Err(ApiError::UpgradeRequired) => {
                ctx.on_upgrade_required();
                return Shown::Interrupted;
            }
            Err(ApiError::RateLimited { retry_after }) => {
                ctx.hub.set_pairing(PairingView::RateLimited);
                let wait = retry_after.unwrap_or(RATE_LIMIT_DEFAULT);
                if !ctx
                    .sleep_while_allowed(Instant::now() + wait, Context::pairing_allowed)
                    .await
                {
                    return Shown::Interrupted;
                }
                return Shown::Restart;
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
                    return Shown::Interrupted;
                }
                return Shown::Restart;
            }
        }
    }
}

/// Writes the token through the store. A refused write shows "Could not save the pairing" and asks for a new code.
fn store_token(ctx: &Context, token: &Secret) -> Shown {
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
async fn pause(ctx: &Context, commands: &mut mpsc::Receiver<Command>) -> bool {
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

/// The time left until `expires_at`, from the wall clock; zero when it has passed.
fn remaining_until(expires_at: DateTime<Utc>, now: DateTime<Utc>) -> Duration {
    (expires_at - now).to_std().unwrap_or(Duration::ZERO)
}

/// Minutes left, rounded up: 5 for a fresh code, 1 in its last minute (AGS-05).
pub fn minutes_left(remaining: Duration) -> u8 {
    let minute = Duration::from_secs(60).as_millis();
    let minutes = remaining.as_millis().div_ceil(minute);
    u8::try_from(minutes).unwrap_or(u8::MAX)
}

/// The next instant at which `minutes_left` changes, given the deadline and `now` (before the deadline).
fn next_minute_change(deadline: Instant, now: Instant) -> Instant {
    let minutes = minutes_left(deadline - now);
    if minutes <= 1 {
        deadline
    } else {
        deadline - Duration::from_secs(60 * u64::from(minutes - 1))
    }
}
