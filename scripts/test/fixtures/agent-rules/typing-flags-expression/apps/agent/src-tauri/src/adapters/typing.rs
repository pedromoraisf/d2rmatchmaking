// Fixture for the typing adapter rule: the flags come from `flags.0` only, never from a literal or another expression.
#![allow(unsafe_code)]

pub fn key(stroke: Stroke) -> KEYBDINPUT {
    let literal = KEYBD_EVENT_FLAGS(0x0008);
    let computed = KEYBD_EVENT_FLAGS(flags.0 | 0x0001);
    KEYBDINPUT {
        wVk: VIRTUAL_KEY(0),
        wScan: stroke.unit,
        dwFlags: KEYBD_EVENT_FLAGS(0x0004),
        time: 0,
        dwExtraInfo: 0,
    }
}
