//! The observation sender (design.md § Vision and fusion, Sender; AGS-19; AD-051). An observation is posted with its
//! idempotency key; a network error or a 5xx is retried with the same key at 1, 2, 4 and 8 s, five attempts in all, then the
//! observation is dropped and counted. A 401 or a 426 drops it at once, and so does any retry that a 401 or 426 overtakes.

use std::time::Duration;

use tokio::time::Instant;
use tracing::Instrument;

use crate::context::Context;
use crate::device_state::DeviceState;
use crate::messages::GameNameObservation;
use crate::ports::{ApiError, ApiGateway};

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

/// Posts `observation` to its room, retrying as AD-051 sets out. The observation is not changed between attempts.
pub async fn send<G: ApiGateway + Send + Sync>(
    ctx: &Context<G>,
    observation: &GameNameObservation,
) -> SendOutcome {
    let epoch = ctx.device.epoch();
    let Some(token) = ctx.tokens.load() else {
        ctx.device.count_dropped_observation();
        return SendOutcome::Dropped;
    };
    let mut failures: usize = 0;
    loop {
        let span = tracing::info_span!("agent.observation.post");
        let outcome = ctx
            .gateway
            .post_observation(&token, observation)
            .instrument(span)
            .await;
        match outcome {
            Ok(()) => return SendOutcome::Posted,
            Err(error @ (ApiError::Unauthorized | ApiError::UpgradeRequired)) => {
                ctx.handle_api_error(&error);
                return drop_observation(ctx);
            }
            Err(error) if is_retryable(&error) => {}
            Err(_) => return drop_observation(ctx),
        }

        failures += 1;
        let Some(delay) = retry_delay(failures) else {
            return drop_observation(ctx);
        };
        let still_allowed = ctx
            .device
            .sleep_while_allowed(Instant::now() + delay, DeviceState::api_allowed)
            .await;
        if !still_allowed || ctx.device.epoch() != epoch {
            return drop_observation(ctx);
        }
    }
}

fn drop_observation<G>(ctx: &Context<G>) -> SendOutcome {
    ctx.device.count_dropped_observation();
    SendOutcome::Dropped
}

/// The wait before the retry that follows failure number `failures` (1 for the first), or `None` when the five attempts
/// are spent.
fn retry_delay(failures: usize) -> Option<Duration> {
    RETRY_DELAYS.get(failures.checked_sub(1)?).copied()
}

/// Whether a failed post is retried with the same key: a lost network or a 5xx, nothing else (AD-051).
fn is_retryable(error: &ApiError) -> bool {
    matches!(error, ApiError::Network | ApiError::Server)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{ApiError, is_retryable, retry_delay};

    #[test]
    fn retry_delays_are_one_two_four_eight_then_stop() {
        assert_eq!(retry_delay(1), Some(Duration::from_secs(1)));
        assert_eq!(retry_delay(2), Some(Duration::from_secs(2)));
        assert_eq!(retry_delay(3), Some(Duration::from_secs(4)));
        assert_eq!(retry_delay(4), Some(Duration::from_secs(8)));
        assert_eq!(retry_delay(5), None);
    }

    #[test]
    fn only_network_and_server_errors_are_retried() {
        assert!(is_retryable(&ApiError::Network));
        assert!(is_retryable(&ApiError::Server));
        for error in [
            ApiError::Unauthorized,
            ApiError::UpgradeRequired,
            ApiError::RateLimited { retry_after: None },
            ApiError::Gone,
            ApiError::Pending,
            ApiError::Invalid,
        ] {
            assert!(!is_retryable(&error), "{error:?} must not be retried");
        }
    }
}
