// Fixture: the baseline test file. edited.rs changes one expected value; the test must report it.
#[test]
fn heartbeat_answers_no_content() {
    let status = heartbeat();
    assert_eq!(status, 204);
    assert!(body.contains("ok"), "the body names the agent");
}
