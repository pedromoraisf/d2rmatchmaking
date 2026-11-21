// Fixture for the typing adapter rule: no other way to send input or move the cursor, only SendInput and GetAsyncKeyState.
#![allow(unsafe_code)]

pub fn other() {
    let _ = (SendMessageA, SendMessageW, PostMessageA, PostMessageW);
    let _ = (
        SendNotifyMessageA,
        SendNotifyMessageW,
        SendMessageTimeoutA,
        SendMessageTimeoutW,
    );
    let _ = (
        PostThreadMessageA,
        PostThreadMessageW,
        SetCursorPos,
        SetKeyboardState,
    );
    let _ = (keybd_event, mouse_event, GetKeyState, GetKeyboardState);
}
