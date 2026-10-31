//! The update schedule and the 426 gate (design.md § Updates; AGS-24, AGS-26, AGS-27; AD-049).
//!
//! The check runs at start, every 6 h and right after a 426. An installed update reopens the API loops (the app restarts
//! into the new version). A failed check keeps the installed version and shows "Update failed — will retry" until the next
//! slot. While a 426 is pending the agent shows "Update required", and only this loop still calls out.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;
use tracing::Instrument;

use crate::context::Context;
use crate::ports::{UpdateChecker, UpdateOutcome};
use crate::view::UpdateView;

/// The interval between scheduled checks (AD-049).
pub const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// The update port in a form the context can hold: the same check, boxed.
pub trait Updater: Send + Sync {
    fn check_boxed(&self) -> Pin<Box<dyn Future<Output = UpdateOutcome> + Send + '_>>;
}

impl<T: UpdateChecker + Send + Sync> Updater for T {
    fn check_boxed(&self) -> Pin<Box<dyn Future<Output = UpdateOutcome> + Send + '_>> {
        Box::pin(UpdateChecker::check(self))
    }
}

/// Checks at start, every 6 h and after each 426, for the life of the agent.
pub async fn run(ctx: Arc<Context>) {
    loop {
        let started = Instant::now();
        check_once(&ctx)
            .instrument(tracing::info_span!("agent.update.check"))
            .await;
        let next = started + CHECK_EVERY;
        tokio::select! {
            () = tokio::time::sleep_until(next) => {}
            () = ctx.update_now.notified() => {}
        }
    }
}

/// One check and what it shows. "Update required" takes precedence while a 426 is pending.
async fn check_once(ctx: &Context) {
    let outcome = ctx.updater.check_boxed().await;
    let required = *ctx.update_required.borrow();
    let pending_view = if required {
        UpdateView::Required
    } else {
        UpdateView::Idle
    };
    match outcome {
        UpdateOutcome::Installed => {
            ctx.update_required.send_replace(false);
            ctx.hub.set_update(UpdateView::Idle);
        }
        UpdateOutcome::UpToDate => ctx.hub.set_update(pending_view),
        UpdateOutcome::Failed(_) => {
            let view = if required {
                UpdateView::Required
            } else {
                UpdateView::Failed
            };
            ctx.hub.set_update(view);
        }
    }
}
