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
pub async fn run<G: Send + Sync + 'static>(ctx: Arc<Context<G>>) {
    loop {
        let started = Instant::now();
        check_once(&ctx)
            .instrument(tracing::info_span!("agent.update.check"))
            .await;
        let next = started + CHECK_EVERY;
        tokio::select! {
            () = tokio::time::sleep_until(next) => {}
            () = ctx.device.update_now.notified() => {}
        }
    }
}

/// One check and what it shows. "Update required" takes precedence while a 426 is pending.
async fn check_once<G: Send + Sync>(ctx: &Context<G>) {
    let outcome = ctx.updater.check_boxed().await;
    let required = *ctx.device.update_required.borrow();
    let (view, required_now) = view_after(&outcome, required);
    if required && !required_now {
        ctx.device.update_installed();
    }
    ctx.device.hub.set_update(view);
}

/// The view a check shows, and the value of the 426 flag after it. An installed update clears the flag (the app restarts
/// into the new version); any other outcome keeps it. A pending 426 shows "Update required" over the outcome.
fn view_after(outcome: &UpdateOutcome, required: bool) -> (UpdateView, bool) {
    match outcome {
        UpdateOutcome::Installed => (UpdateView::Idle, false),
        UpdateOutcome::UpToDate => {
            let view = if required {
                UpdateView::Required
            } else {
                UpdateView::Idle
            };
            (view, required)
        }
        UpdateOutcome::Failed(_) => {
            let view = if required {
                UpdateView::Required
            } else {
                UpdateView::Failed
            };
            (view, required)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{CHECK_EVERY, view_after};
    use crate::ports::{UpdateFailure, UpdateOutcome};
    use crate::view::UpdateView;

    #[test]
    fn installed_update_clears_the_required_flag() {
        assert_eq!(
            view_after(&UpdateOutcome::Installed, true),
            (UpdateView::Idle, false)
        );
        assert_eq!(
            view_after(&UpdateOutcome::Installed, false),
            (UpdateView::Idle, false)
        );
    }

    #[test]
    fn up_to_date_keeps_update_required_while_pending() {
        assert_eq!(
            view_after(&UpdateOutcome::UpToDate, true),
            (UpdateView::Required, true)
        );
        assert_eq!(
            view_after(&UpdateOutcome::UpToDate, false),
            (UpdateView::Idle, false)
        );
    }

    #[test]
    fn failed_check_shows_update_failed_unless_required() {
        let failed = UpdateOutcome::Failed(UpdateFailure::Download);
        assert_eq!(view_after(&failed, false), (UpdateView::Failed, false));
        assert_eq!(view_after(&failed, true), (UpdateView::Required, true));
    }

    #[test]
    fn update_check_is_every_six_hours() {
        assert_eq!(CHECK_EVERY, Duration::from_secs(6 * 60 * 60));
    }
}
