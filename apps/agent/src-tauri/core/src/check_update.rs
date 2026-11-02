//! The check-update use case (design.md § Updates; AGS-24, AGS-26, AGS-27; AD-049).
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

use crate::device_state::DeviceState;
use crate::groups::UpdatePorts;
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
pub async fn run(device: Arc<DeviceState>, ports: UpdatePorts) {
    loop {
        let started = Instant::now();
        check_once(&device, &ports)
            .instrument(tracing::info_span!("agent.update.check"))
            .await;
        let next = started + CHECK_EVERY;
        tokio::select! {
            () = tokio::time::sleep_until(next) => {}
            () = device.update_now.notified() => {}
        }
    }
}

/// One check and what it shows. "Update required" takes precedence while a 426 is pending.
async fn check_once(device: &DeviceState, ports: &UpdatePorts) {
    let outcome = ports.updater.check_boxed().await;
    let required = *device.update_required.borrow();
    let (view, required_now) = view_after(&outcome, required);
    if required && !required_now {
        device.update_installed();
    }
    device.hub.set_update(view);
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
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use super::{CHECK_EVERY, Updater, check_once, run, view_after};
    use crate::device_state::DeviceState;
    use crate::fakes::{MemoryTokens, NullSink, fails_fast};
    use crate::groups::UpdatePorts;
    use crate::ports::{UpdateFailure, UpdateOutcome};
    use crate::view::UpdateView;

    /// An updater that answers one fixed outcome.
    struct Answering(UpdateOutcome);

    impl Updater for Answering {
        fn check_boxed(&self) -> Pin<Box<dyn Future<Output = UpdateOutcome> + Send + '_>> {
            let outcome = self.0;
            Box::pin(async move { outcome })
        }
    }

    /// An updater that counts its checks and answers "up to date".
    #[derive(Default)]
    struct CountingUpdater(AtomicUsize);

    impl Updater for CountingUpdater {
        fn check_boxed(&self) -> Pin<Box<dyn Future<Output = UpdateOutcome> + Send + '_>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { UpdateOutcome::UpToDate })
        }
    }

    fn checks(updater: &CountingUpdater) -> usize {
        updater.0.load(Ordering::SeqCst)
    }

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
    fn view_after_required_wins() {
        for outcome in [
            UpdateOutcome::UpToDate,
            UpdateOutcome::Failed(UpdateFailure::Download),
        ] {
            assert_eq!(
                view_after(&outcome, true),
                (UpdateView::Required, true),
                "a pending 426 shows update required over the outcome"
            );
        }
        assert_eq!(
            view_after(&UpdateOutcome::Installed, true),
            (UpdateView::Idle, false),
            "an installed update clears the pending 426"
        );
    }

    #[test]
    fn update_check_is_every_six_hours() {
        assert_eq!(CHECK_EVERY, Duration::from_secs(6 * 60 * 60));
    }

    #[test]
    fn check_update_at_start_every_six_hours_and_after_426() {
        fails_fast(|| async {
            let updater = Arc::new(CountingUpdater::default());
            let device = Arc::new(DeviceState::new(Arc::new(NullSink)));
            let tokens = MemoryTokens::default();
            let ports = UpdatePorts {
                updater: updater.clone(),
            };
            tokio::spawn(run(Arc::clone(&device), ports));

            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(checks(&updater), 1, "the check runs at start");
            tokio::time::sleep(CHECK_EVERY - Duration::from_secs(2)).await;
            assert_eq!(checks(&updater), 1, "no check before 6 h");
            tokio::time::sleep(Duration::from_secs(2)).await;
            assert_eq!(checks(&updater), 2, "the next check is at 6 h");

            device.on_upgrade_required(&tokens);
            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(checks(&updater), 3, "a 426 checks at once");
        });
    }

    #[tokio::test(start_paused = true)]
    async fn an_up_to_date_check_keeps_a_pending_426() {
        let device = DeviceState::new(Arc::new(NullSink));
        device.on_upgrade_required(&MemoryTokens::default());
        let ports = UpdatePorts {
            updater: Arc::new(Answering(UpdateOutcome::UpToDate)),
        };

        check_once(&device, &ports).await;

        assert!(
            *device.update_required.borrow(),
            "an up-to-date answer keeps a pending 426"
        );
        assert!(!device.api_allowed(), "the API loops stay stopped");
        assert_eq!(device.hub.snapshot().update, UpdateView::Required);
    }

    #[tokio::test(start_paused = true)]
    async fn a_check_that_leaves_the_gate_alone_does_not_signal_it() {
        let device = DeviceState::new(Arc::new(NullSink));
        let gate = device.update_required.subscribe();
        let ports = UpdatePorts {
            updater: Arc::new(Answering(UpdateOutcome::UpToDate)),
        };

        check_once(&device, &ports).await;

        assert!(
            !gate.has_changed().expect("the gate is open"),
            "with no 426 pending, the check does not touch the gate"
        );
    }
}
