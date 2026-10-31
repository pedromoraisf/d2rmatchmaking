//! The observation sender (design.md § Vision and fusion, Sender; AGS-19; AD-051). An observation is posted with its
//! idempotency key; a network error or a 5xx is retried with the same key at 1, 2, 4 and 8 s, five attempts in all, then the
//! observation is dropped and counted. A 401 or a 426 drops it at once, and so does any retry that a 401 or 426 overtakes.

use std::time::Duration;

use tokio::time::Instant;
use tracing::Instrument;
use uuid::Uuid;

use crate::api_client::ApiError;
use crate::context::Context;
use crate::contracts::generated::Observation;

/// The waits between attempts (AD-051): five attempts in all.
pub const RETRY_DELAYS: [Duration; 4] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
];

/// How a send ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendOutcome {
    Posted,
    Dropped,
}

/// Posts `observation` to `room`, retrying as AD-051 sets out. The observation is not changed between attempts.
pub async fn send(ctx: &Context, room: Uuid, observation: &Observation) -> SendOutcome {
    let epoch = ctx.epoch();
    let Some(token) = ctx.tokens.load() else {
        ctx.count_dropped_observation();
        return SendOutcome::Dropped;
    };
    let mut failures: usize = 0;
    loop {
        let span = tracing::info_span!("agent.observation.post");
        let outcome = ctx
            .api
            .post_observation(&token, room, observation)
            .instrument(span)
            .await;
        match outcome {
            Ok(()) => return SendOutcome::Posted,
            Err(ApiError::Unauthorized) => {
                ctx.on_unauthorized();
                return drop_observation(ctx);
            }
            Err(ApiError::UpgradeRequired) => {
                ctx.on_upgrade_required();
                return drop_observation(ctx);
            }
            Err(ApiError::Network | ApiError::Server) => {}
            Err(_) => return drop_observation(ctx),
        }

        failures += 1;
        let Some(delay) = RETRY_DELAYS.get(failures - 1) else {
            return drop_observation(ctx);
        };
        let still_allowed = ctx
            .sleep_while_allowed(Instant::now() + *delay, Context::api_allowed)
            .await;
        if !still_allowed || ctx.epoch() != epoch {
            return drop_observation(ctx);
        }
    }
}

fn drop_observation(ctx: &Context) -> SendOutcome {
    ctx.count_dropped_observation();
    SendOutcome::Dropped
}
