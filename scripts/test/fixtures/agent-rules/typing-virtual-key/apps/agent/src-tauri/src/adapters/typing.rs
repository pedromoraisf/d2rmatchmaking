// Fixture for the typing adapter rule: a keystroke carries virtual key 0 and only the Unicode and key-up flags.
#![allow(unsafe_code)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_SCANCODE, KEYEVENTF_UNICODE, VIRTUAL_KEY,
};

pub fn keys(vk: u16) -> [KEYBDINPUT; 2] {
    let flags = KEYEVENTF_UNICODE | KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY;
    [
        KEYBDINPUT { wVk: VIRTUAL_KEY(13), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
        KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
    ]
}
