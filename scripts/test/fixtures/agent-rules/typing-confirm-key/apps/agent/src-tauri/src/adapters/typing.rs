// Fixture for the typing adapter rule: Enter, Tab, Space, Escape and Backspace are never named.
#![allow(unsafe_code)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    KEYEVENTF_UNICODE, SendInput, VK_BACK, VK_ESCAPE, VK_RETURN, VK_SPACE, VK_TAB,
};

pub fn confirm() {
    let _ = (KEYEVENTF_UNICODE, SendInput, VK_RETURN, VK_TAB, VK_SPACE, VK_ESCAPE, VK_BACK);
}
