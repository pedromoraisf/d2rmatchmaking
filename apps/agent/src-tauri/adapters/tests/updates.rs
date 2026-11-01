//! AGS-24, AGS-26, AGS-27: the update check runs at start, every 6 h and after a 426; a failed check keeps the installed
//! version and retries at the next slot; a 426 stops the API loops until an update installs.

mod support;

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_core::beat;
use d2rmm_agent_core::ports::{UpdateFailure, UpdateOutcome};
use d2rmm_agent_core::stream;
use d2rmm_agent_core::updates;
use d2rmm_agent_core::view::UpdateView;
use support::fake_api::{Answer, Operation, TOKEN};
use support::harness::{Harness, advance, count, settle, until};

/// The update cadence as the spec states it: every 6 h. Written out here, not imported, so a change to the agent's
/// constant fails this test (AGS-24).
const SIX_HOURS: Duration = Duration::from_secs(6 * 60 * 60);

fn update_view(h: &Harness) -> Option<UpdateView> {
    h.sink.last().map(|view| view.update)
}

#[tokio::test(start_paused = true)]
async fn update_checks_at_start_every_6h_and_after_426() {
    let h = Harness::start(None).await;
    h.updater.script([UpdateOutcome::UpToDate; 3]);
    tokio::spawn(updates::run(Arc::clone(&h.context)));

    until("the check at start", || h.updater.calls() == 1).await;
    advance(SIX_HOURS - Duration::from_secs(1)).await;
    assert_eq!(h.updater.calls(), 1, "no check before 6 h");
    advance(Duration::from_secs(1)).await;
    until("the check at 6 h", || h.updater.calls() == 2).await;

    h.ctx.on_upgrade_required();
    until("the check right after a 426", || h.updater.calls() == 3).await;
}

#[tokio::test(start_paused = true)]
async fn update_failure_keeps_version_and_retries() {
    let h = Harness::start(None).await;
    h.updater.script([
        UpdateOutcome::Failed(UpdateFailure::Signature),
        UpdateOutcome::UpToDate,
    ]);
    tokio::spawn(updates::run(Arc::clone(&h.context)));

    until("the failure is shown", || {
        update_view(&h) == Some(UpdateView::Failed)
    })
    .await;
    assert!(
        !*h.ctx.update_required.borrow(),
        "the installed version keeps running"
    );

    advance(SIX_HOURS).await;
    until("the check at the next slot", || h.updater.calls() == 2).await;
    until("the view clears", || {
        update_view(&h) == Some(UpdateView::Idle)
    })
    .await;
}

#[tokio::test(start_paused = true)]
async fn upgrade_required_stops_api_loops() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.set_paired(true);
    h.api
        .script(Operation::Heartbeat, [Answer::UpgradeRequired]);
    h.updater.script([
        UpdateOutcome::UpToDate,
        UpdateOutcome::UpToDate,
        UpdateOutcome::Installed,
    ]);
    tokio::spawn(beat::run(
        Arc::clone(&h.context.device),
        h.context.heartbeat_ports(),
        h.context.version.clone(),
    ));
    tokio::spawn(stream::run(Arc::clone(&h.context)));
    tokio::spawn(updates::run(Arc::clone(&h.context)));

    until("the 426 is answered", || {
        count(&h.api, Operation::Heartbeat) == 1
    })
    .await;
    until("the check right after the 426", || h.updater.calls() == 2).await;
    settle().await;
    assert_eq!(update_view(&h), Some(UpdateView::Required));

    let requests_before = h.api.requests().len();
    advance(Duration::from_secs(3600)).await;
    assert_eq!(
        h.api.requests().len(),
        requests_before,
        "no API request while an update is pending"
    );

    // The scheduled check at 6 h installs the update: the API loops run again.
    advance(SIX_HOURS - Duration::from_secs(3600)).await;
    until("the heartbeat resumes", || {
        count(&h.api, Operation::Heartbeat) == 2
    })
    .await;
    assert_eq!(update_view(&h), Some(UpdateView::Idle));
}
