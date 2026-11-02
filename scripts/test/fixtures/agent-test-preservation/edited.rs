// Fixture: the baseline test file with one expected value edited (204 became 200).
#[test]
fn heartbeat_answers_no_content() {
    let status = heartbeat();
    assert_eq!(status, 200);
    assert!(body.contains("ok"), "the body names the agent");
}
