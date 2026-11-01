//! AGS-05 to AGS-08, AGS-34, AGS-35: the pairing state machine against the fake API, under a paused clock.

mod support;

use std::time::Duration;

use d2rmm_agent_core::pairing::Command;
use d2rmm_agent_core::view::PairingView;
use support::fake_api::{Answer, CODE, Operation, TOKEN};
use support::harness::{Harness, advance, count, pending, settle, until};

const MINUTE: Duration = Duration::from_secs(60);

fn shown_code(view: Option<PairingView>) -> Option<(String, u8)> {
    match view {
        Some(PairingView::ShowingCode { code, minutes_left }) => Some((code, minutes_left)),
        _ => None,
    }
}

async fn wait_for_code(h: &Harness) {
    until("a shown code", || shown_code(h.sink.pairing()).is_some()).await;
}

#[tokio::test(start_paused = true)]
async fn shows_code_with_minutes_left() {
    let h = Harness::start(None).await;
    h.api.script(Operation::Claim, pending(200));
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    assert_eq!(
        shown_code(h.sink.pairing()),
        Some((CODE.to_string(), 5)),
        "a fresh code shows five minutes"
    );
    for expected in [4, 3, 2, 1] {
        advance(MINUTE).await;
        assert_eq!(
            shown_code(h.sink.pairing()).map(|(_, minutes)| minutes),
            Some(expected),
            "minutes left rounds up"
        );
    }
    assert_eq!(
        count(&h.api, Operation::RequestCode),
        1,
        "the code is shown, not replaced, while it is valid"
    );
}

#[tokio::test(start_paused = true)]
async fn code_with_4_min_30_s_left_shows_5() {
    // Four and a half minutes left is five minutes shown: the count rounds up, never down (AGS-05).
    let h = Harness::start(None).await;
    h.api
        .script(Operation::RequestCode, [Answer::Lifetime(270)]);
    h.api.script(Operation::Claim, pending(200));
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    assert_eq!(
        shown_code(h.sink.pairing()),
        Some((CODE.to_string(), 5)),
        "4 min 30 s left shows 5 min"
    );
}

#[tokio::test(start_paused = true)]
async fn code_with_1_s_left_shows_1() {
    // A second left is shown as one minute, the last minute of the code (AGS-05).
    let h = Harness::start(None).await;
    h.api.script(Operation::RequestCode, [Answer::Lifetime(1)]);
    h.api.script(Operation::Claim, pending(200));
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    assert_eq!(
        shown_code(h.sink.pairing()),
        Some((CODE.to_string(), 1)),
        "1 s left shows 1 min"
    );
}

#[tokio::test(start_paused = true)]
async fn claims_every_two_seconds_until_token() {
    let h = Harness::start(None).await;
    h.api.script(
        Operation::Claim,
        [Answer::Pending, Answer::Pending, Answer::Ok],
    );
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;
    assert_eq!(
        count(&h.api, Operation::Claim),
        0,
        "no claim before two seconds"
    );

    advance(Duration::from_secs(2)).await;
    assert_eq!(count(&h.api, Operation::Claim), 1);
    advance(Duration::from_secs(2)).await;
    assert_eq!(count(&h.api, Operation::Claim), 2);
    advance(Duration::from_secs(2)).await;
    assert_eq!(
        count(&h.api, Operation::Claim),
        3,
        "the third claim returns the token"
    );

    advance(Duration::from_secs(20)).await;
    assert_eq!(
        count(&h.api, Operation::Claim),
        3,
        "claiming stops once paired"
    );
}

#[tokio::test(start_paused = true)]
async fn keeps_claiming_on_202() {
    let h = Harness::start(None).await;
    h.api
        .script(Operation::Claim, [Answer::Pending, Answer::Ok]);
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    advance(Duration::from_secs(2)).await;
    assert_eq!(
        shown_code(h.sink.pairing()),
        Some((CODE.to_string(), 5)),
        "a 202 keeps the code shown"
    );
    advance(Duration::from_secs(2)).await;
    assert_eq!(count(&h.api, Operation::Claim), 2);
}

#[tokio::test(start_paused = true)]
async fn stores_token_and_shows_paired() {
    let h = Harness::start(None).await;
    h.api.script(Operation::Claim, [Answer::Ok]);
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    advance(Duration::from_secs(2)).await;
    assert_eq!(h.tokens.stored().as_deref(), Some(TOKEN));
    assert_eq!(h.sink.pairing(), Some(PairingView::Paired));
    assert_eq!(
        h.tokens.save_calls(),
        1,
        "the token is written once, through the store"
    );
}

#[tokio::test(start_paused = true)]
async fn new_code_after_410_or_expiry() {
    let h = Harness::start(None).await;
    h.api.script(Operation::Claim, [Answer::Gone]);
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    advance(Duration::from_secs(2)).await;
    until("the replacement code", || {
        count(&h.api, Operation::RequestCode) == 2
    })
    .await;
    assert!(
        shown_code(h.sink.pairing()).is_some(),
        "the replacement code is shown"
    );
    assert!(h.tokens.stored().is_none(), "no token is written on a 410");
}

#[tokio::test(start_paused = true)]
async fn expired_code_requests_a_new_code() {
    let h = Harness::start(None).await;
    h.api.script(Operation::Claim, pending(200));
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    advance(Duration::from_secs(300)).await;
    until("the replacement code", || {
        count(&h.api, Operation::RequestCode) == 2
    })
    .await;
    wait_for_code(&h).await;
}

#[tokio::test(start_paused = true)]
async fn unauthorized_deletes_token_and_repairs() {
    let h = Harness::start(Some(TOKEN)).await;
    let _commands = h.spawn_pairing();
    settle().await;
    assert_eq!(
        count(&h.api, Operation::RequestCode),
        0,
        "a stored token pairs without a code"
    );

    h.ctx.on_unauthorized();
    wait_for_code(&h).await;
    assert!(
        h.tokens.stored().is_none(),
        "the 401 deletes the stored token"
    );
    assert_eq!(count(&h.api, Operation::RequestCode), 1);
}

#[tokio::test(start_paused = true)]
async fn unauthorized_on_claim_resets_the_unused_count() {
    // Code one expires unused (410), code two is refused with 401, code three expires unused. Two unused codes in a row
    // would pause, but the 401 starts the count again: code four is requested and the loop does not pause (AD-058).
    let h = Harness::start(None).await;
    h.api.script(
        Operation::Claim,
        [Answer::Gone, Answer::Unauthorized, Answer::Gone],
    );
    h.api.script(Operation::Claim, pending(400));
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    advance(Duration::from_secs(2)).await;
    until("the second code", || {
        count(&h.api, Operation::RequestCode) == 2
    })
    .await;
    advance(Duration::from_secs(2)).await;
    until("the third code after the 401", || {
        count(&h.api, Operation::RequestCode) == 3
    })
    .await;
    advance(Duration::from_secs(2)).await;
    until("the fourth code", || {
        count(&h.api, Operation::RequestCode) == 4
    })
    .await;
    wait_for_code(&h).await;
    assert!(
        !h.sink.pairing_history().contains(&PairingView::Paused),
        "one unused code after the 401 does not pause the loop"
    );
}

#[tokio::test(start_paused = true)]
async fn save_failure_requests_a_new_code() {
    let h = Harness::start(None).await;
    h.api.script(Operation::Claim, [Answer::Ok]);
    h.tokens.refuse_saves(1);
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    advance(Duration::from_secs(2)).await;
    until("a new code after the refused write", || {
        count(&h.api, Operation::RequestCode) == 2
    })
    .await;
    assert!(
        h.sink.pairing_history().contains(&PairingView::SaveFailed),
        "the refused write is shown"
    );
    assert!(h.tokens.stored().is_none(), "nothing was stored");
}

#[tokio::test(start_paused = true)]
async fn pauses_after_two_unused_codes() {
    let h = Harness::start(None).await;
    h.api.script(Operation::Claim, [Answer::Gone, Answer::Gone]);
    h.api.script(Operation::Claim, pending(400));
    let commands = h.spawn_pairing();
    wait_for_code(&h).await;

    advance(Duration::from_secs(2)).await;
    until("the second code", || {
        count(&h.api, Operation::RequestCode) == 2
    })
    .await;
    advance(Duration::from_secs(2)).await;
    until("the pause", || {
        h.sink.pairing() == Some(PairingView::Paused)
    })
    .await;

    advance(Duration::from_secs(3600)).await;
    assert_eq!(
        count(&h.api, Operation::RequestCode),
        2,
        "a paused agent requests nothing"
    );

    commands
        .send(Command::GetNewCode)
        .await
        .expect("the loop listens");
    until("one new code", || {
        count(&h.api, Operation::RequestCode) == 3
    })
    .await;
    wait_for_code(&h).await;

    advance(Duration::from_secs(300)).await;
    until("a code after the reset", || {
        count(&h.api, Operation::RequestCode) == 4
    })
    .await;
    wait_for_code(&h).await;
}

#[tokio::test(start_paused = true)]
async fn pairing_success_resets_the_unused_count() {
    let h = Harness::start(None).await;
    // Code one is answered 410 (one unused), code two is claimed, code three is pending from then on.
    h.api.script(
        Operation::Claim,
        [Answer::Gone, Answer::Ok].into_iter().chain(pending(400)),
    );
    let _commands = h.spawn_pairing();
    wait_for_code(&h).await;

    advance(Duration::from_secs(2)).await;
    until("the second code", || {
        count(&h.api, Operation::RequestCode) == 2
    })
    .await;
    advance(Duration::from_secs(2)).await;
    until("the pairing", || {
        h.tokens.stored().as_deref() == Some(TOKEN)
    })
    .await;

    h.ctx.on_unauthorized();
    until("a new pairing code", || {
        count(&h.api, Operation::RequestCode) == 3
    })
    .await;

    advance(Duration::from_secs(300)).await;
    until("the next code", || {
        count(&h.api, Operation::RequestCode) == 4
    })
    .await;
    wait_for_code(&h).await;
}

#[tokio::test(start_paused = true)]
async fn waits_retry_after_on_429() {
    // With Retry-After: 120 the second code arrives after 120 s, and not before.
    let h = Harness::start(None).await;
    h.api.script(
        Operation::RequestCode,
        [
            Answer::RateLimited {
                retry_after: Some(120),
            },
            Answer::Ok,
        ],
    );
    h.api.script(Operation::Claim, pending(200));
    let commands = h.spawn_pairing();
    until("the rate limit", || {
        h.sink.pairing() == Some(PairingView::RateLimited)
    })
    .await;

    advance(Duration::from_secs(119)).await;
    commands
        .send(Command::GetNewCode)
        .await
        .expect("the loop listens");
    settle().await;
    assert_eq!(
        count(&h.api, Operation::RequestCode),
        1,
        "no code before Retry-After"
    );
    assert_eq!(
        h.sink.pairing(),
        Some(PairingView::RateLimited),
        "no Get a new code during the wait"
    );

    advance(Duration::from_secs(1)).await;
    wait_for_code(&h).await;
    assert_eq!(count(&h.api, Operation::RequestCode), 2);
}

#[tokio::test(start_paused = true)]
async fn waits_sixty_minutes_on_429_without_retry_after() {
    let h = Harness::start(None).await;
    h.api.script(
        Operation::RequestCode,
        [Answer::RateLimited { retry_after: None }, Answer::Ok],
    );
    h.api.script(Operation::Claim, pending(2000));
    let _commands = h.spawn_pairing();
    until("the rate limit", || {
        h.sink.pairing() == Some(PairingView::RateLimited)
    })
    .await;

    advance(Duration::from_secs(59 * 60)).await;
    assert_eq!(count(&h.api, Operation::RequestCode), 1);
    advance(Duration::from_secs(60)).await;
    wait_for_code(&h).await;
    assert_eq!(
        count(&h.api, Operation::RequestCode),
        2,
        "one hour after the 429"
    );
}

#[tokio::test(start_paused = true)]
async fn retries_code_request_every_15s_when_unreachable() {
    let h = Harness::start(None).await;
    h.api.refuse_connections().await;
    let _commands = h.spawn_pairing();
    until("the unreachable state", || {
        h.sink.pairing() == Some(PairingView::Unreachable)
    })
    .await;

    advance(Duration::from_secs(14)).await;
    h.api.accept_connections().await;
    advance(Duration::from_millis(900)).await;
    assert_eq!(
        count(&h.api, Operation::RequestCode),
        0,
        "the next attempt is at 15 s, not before"
    );

    advance(Duration::from_millis(100)).await;
    wait_for_code(&h).await;
    assert_eq!(count(&h.api, Operation::RequestCode), 1);
}
