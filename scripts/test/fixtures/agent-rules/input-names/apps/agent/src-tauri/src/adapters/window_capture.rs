// Fixture for the input rule: no file may name an input function or allow the clippy ban on it.
#![allow(unsafe_code)]
#![allow(clippy::disallowed_methods)]
use windows::Win32::UI::Input::KeyboardAndMouse::SendInput;

pub fn press() {
    let _ = SendInput;
}
