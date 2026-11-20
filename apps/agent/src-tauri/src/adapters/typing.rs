//! Assisted typing's input (FR-28, AST-05, AST-06; ADR 010). This is the one file of the agent that sends input, and it can
//! send one thing: a Unicode character keystroke (`KEYEVENTF_UNICODE`, virtual key 0), a key-down and a key-up, for a
//! `TypableChar` of the domain (`a`–`z`, `0`–`9`, `-`). It also reads whether the hotkey's own Ctrl, Shift and Alt keys are
//! held. It names no other key, no mouse or hardware event and no clipboard call, and the source rules fail if it ever does
//! (`agent-source-rules.test.mjs`, AST-09). The pure parts are tested everywhere; the Win32 calls exist on Windows only.
#![allow(unsafe_code)]
// `SendInput` and `GetAsyncKeyState` are banned by clippy.toml for the rest of the agent; this file alone may call them.
#![allow(clippy::disallowed_methods)]

use d2rmm_agent_domain::typing::{Modifiers, TypableChar};

/// One half of a keystroke: the UTF-16 code unit of the character and whether it is the key-up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Keystroke {
    pub unit: u16,
    pub released: bool,
}

/// The two events of one character: down, then up. A `TypableChar` is ASCII, so it is one UTF-16 code unit.
pub fn keystrokes(character: TypableChar) -> [Keystroke; 2] {
    let mut buffer = [0_u16; 2];
    let unit = character.get().encode_utf16(&mut buffer)[0];
    [
        Keystroke {
            unit,
            released: false,
        },
        Keystroke {
            unit,
            released: true,
        },
    ]
}

/// The modifier keys of a hotkey that are read: only the ones it uses, never any other key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModifierKey {
    Control,
    Shift,
    Alt,
}

pub fn keys_to_read(modifiers: Modifiers) -> Vec<ModifierKey> {
    [
        (modifiers.ctrl, ModifierKey::Control),
        (modifiers.shift, ModifierKey::Shift),
        (modifiers.alt, ModifierKey::Alt),
    ]
    .into_iter()
    .filter_map(|(used, key)| used.then_some(key))
    .collect()
}

#[cfg(windows)]
pub use keyboard::{HeldModifiers, SendTyper};

#[cfg(windows)]
mod keyboard {
    use std::mem::size_of;

    use d2rmm_agent_core::ports::{KeyTyper, ModifierState};
    use d2rmm_agent_domain::typing::{Modifiers, TypableChar};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT,
        KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, SendInput, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT,
    };

    use super::{ModifierKey, keys_to_read, keystrokes};

    /// Types one character into the foreground window, as a Unicode keystroke (AST-06).
    #[derive(Debug, Default, Clone, Copy)]
    pub struct SendTyper;

    impl KeyTyper for SendTyper {
        fn type_char(&self, character: TypableChar) {
            let events = keystrokes(character).map(|stroke| {
                let flags = if stroke.released {
                    KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
                } else {
                    KEYEVENTF_UNICODE
                };
                INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VIRTUAL_KEY(0),
                            wScan: stroke.unit,
                            dwFlags: KEYBD_EVENT_FLAGS(flags.0),
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                }
            });
            let size = i32::try_from(size_of::<INPUT>()).unwrap_or(i32::MAX);
            // SAFETY: `events` is an initialised array of two keyboard INPUT structures that lives across the call, and `size`
            // is the size of one of them, as SendInput requires.
            let _sent = unsafe { SendInput(&events, size) };
        }
    }

    /// Whether the hotkey's own modifier keys are held now (AST-05): Ctrl, Shift and Alt, and only the ones it uses.
    #[derive(Debug, Default, Clone, Copy)]
    pub struct HeldModifiers;

    impl ModifierState for HeldModifiers {
        fn any_held(&self, modifiers: Modifiers) -> bool {
            keys_to_read(modifiers).into_iter().any(|key| {
                let virtual_key = match key {
                    ModifierKey::Control => VK_CONTROL,
                    ModifierKey::Shift => VK_SHIFT,
                    ModifierKey::Alt => VK_MENU,
                };
                // SAFETY: a plain read of the state of one modifier key; it takes no pointer.
                let state = unsafe { GetAsyncKeyState(i32::from(virtual_key.0)) };
                state < 0
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_domain::typing::{Modifiers, TypableChar, TypableName};

    use super::{Keystroke, ModifierKey, keys_to_read, keystrokes};

    #[test]
    fn a_character_is_a_unicode_down_then_up_of_its_own_code_unit() {
        let a = TypableChar::new('a').expect("typable");
        assert_eq!(
            keystrokes(a),
            [
                Keystroke {
                    unit: 0x61,
                    released: false
                },
                Keystroke {
                    unit: 0x61,
                    released: true
                },
            ]
        );
    }

    #[test]
    fn every_name_the_server_generates_is_only_down_up_pairs_of_its_own_characters() {
        for activity in [
            "baal", "chaos", "cows", "tz", "heralds", "duel1v1", "duel2v2", "arena6",
        ] {
            let text = format!("mm{activity}h-12");
            let name = TypableName::new(&text).expect("typable");
            let events: Vec<Keystroke> = name.chars().iter().flat_map(|c| keystrokes(*c)).collect();
            assert_eq!(events.len(), text.len() * 2);
            for (pair, expected) in events.chunks(2).zip(text.chars()) {
                assert_eq!(pair[0].unit, expected as u16);
                assert!(!pair[0].released && pair[1].released);
                assert_eq!(pair[0].unit, pair[1].unit);
                assert!(
                    (pair[0].unit as u8).is_ascii_lowercase()
                        || (pair[0].unit as u8).is_ascii_digit()
                        || pair[0].unit == u16::from(b'-'),
                    "no control, space or other key: {}",
                    pair[0].unit
                );
            }
        }
    }

    #[test]
    fn only_the_modifiers_the_hotkey_uses_are_read() {
        let keys = |ctrl, shift, alt| keys_to_read(Modifiers { ctrl, shift, alt });
        assert_eq!(
            keys(true, true, false),
            [ModifierKey::Control, ModifierKey::Shift]
        );
        assert_eq!(keys(false, false, true), [ModifierKey::Alt]);
        assert_eq!(
            keys(true, false, true),
            [ModifierKey::Control, ModifierKey::Alt]
        );
        assert!(keys(false, false, false).is_empty());
    }
}
