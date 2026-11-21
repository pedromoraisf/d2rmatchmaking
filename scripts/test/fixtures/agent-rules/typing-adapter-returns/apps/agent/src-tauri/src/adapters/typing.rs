// Fixture for the input rule (AST-13): a typing adapter that comes back is rejected, whatever it does with the input.
#![allow(unsafe_code)]
#![allow(clippy::disallowed_methods)]
use windows::Win32::UI::Input::KeyboardAndMouse::SendInput;

pub fn type_unicode() {
    let _ = SendInput;
}
