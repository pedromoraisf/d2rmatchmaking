// Fixture for the instrument rule: #[instrument] must carry skip_all so arguments never reach a span.
use tracing::instrument;

#[instrument]
pub fn start(token: String) {
    let _ = token;
}
