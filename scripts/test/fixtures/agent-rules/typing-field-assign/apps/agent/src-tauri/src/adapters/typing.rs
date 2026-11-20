// Fixture for the typing adapter rule: a field set by assignment, and a second KEYBDINPUT, are not the one keystroke.
#![allow(unsafe_code)]

pub fn keys(mut input: INPUT, vk: u16) -> INPUT {
    input.Anonymous.ki.wVk = VIRTUAL_KEY(vk);
    input.Anonymous.ki.wScan = 0x1c;
    let other = KEYBDINPUT {
        wVk: VIRTUAL_KEY(0),
        wScan: stroke.unit,
        dwFlags: KEYBD_EVENT_FLAGS(flags.0),
        time: 0,
        dwExtraInfo: 0,
    };
    let more = KEYBDINPUT {
        wVk: VIRTUAL_KEY(0),
        wScan: stroke.unit,
        dwFlags: KEYBD_EVENT_FLAGS(flags.0),
        time: 0,
        dwExtraInfo: 0,
    };
    input
}
