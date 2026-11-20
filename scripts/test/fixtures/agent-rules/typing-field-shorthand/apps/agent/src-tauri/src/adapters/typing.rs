// Fixture for the typing adapter rule: field shorthand takes a virtual key or a scan code from a local.
#![allow(unsafe_code)]

pub fn key(wVk: VIRTUAL_KEY, wScan: u16, dwFlags: KEYBD_EVENT_FLAGS) -> KEYBDINPUT {
    KEYBDINPUT {
        wVk,
        wScan,
        dwFlags,
        time: 0,
        dwExtraInfo: 0,
    }
}
