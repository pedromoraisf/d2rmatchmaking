// Fixture for the input rule: each input name below, alone, is refused outside typing.rs.
pub fn a() {
    let _ = SendMessageA;
}
pub fn b() {
    let _ = SendNotifyMessageW;
}
pub fn c() {
    let _ = SendMessageTimeoutA;
}
pub fn d() {
    let _ = PostThreadMessageW;
}
pub fn e() {
    let _ = SetCursorPos;
}
pub fn f() {
    let _ = SetKeyboardState;
}
pub fn g() {
    let _ = keybd_event;
}
pub fn h() {
    let _ = mouse_event;
}
