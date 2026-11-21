//! The agent view and the state sink (AGS-34). The hub owns the view, publishes every change once through the sink and
//! is the only owner of the sink. Loops and effects change the view through its setters.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use d2rmm_agent_domain::typing::HotkeyChoice;

use crate::ports::StateSink;
use crate::view::{
    AgentView, CaptureView, Connectivity, DiagnosticsView, HotkeyFailure, HotkeyFault, HotkeyPress,
    HotkeySlot, HotkeysView, PairingView, RoomView, UpdateView,
};

/// Owns the agent view and publishes every change through the state sink (AGS-34).
pub struct Hub {
    sink: Arc<dyn StateSink + Send + Sync>,
    view: Mutex<AgentView>,
}

impl Hub {
    pub(crate) fn new(sink: Arc<dyn StateSink + Send + Sync>) -> Self {
        Self {
            sink,
            view: Mutex::new(AgentView {
                pairing: PairingView::Requesting,
                connectivity: Connectivity::Connected,
                room: None,
                update: UpdateView::Idle,
                ready_check_open: false,
                hotkeys: HotkeysView::of(&HotkeyChoice::default_accept()),
                hotkey_unavailable: Vec::new(),
                last_press: None,
                diagnostics: None,
                capture: None,
                config_version: 0,
            }),
        }
    }

    fn change(&self, apply: impl FnOnce(&mut AgentView)) {
        let snapshot = {
            let mut view = lock(&self.view);
            apply(&mut view);
            view.clone()
        };
        self.sink.publish(snapshot);
    }

    pub fn set_pairing(&self, pairing: PairingView) {
        self.change(|view| view.pairing = pairing);
    }

    pub fn set_connectivity(&self, connectivity: Connectivity) {
        self.change(|view| view.connectivity = connectivity);
    }

    pub fn set_room(&self, room: Option<RoomView>) {
        self.change(|view| view.room = room);
    }

    pub fn set_update(&self, update: UpdateView) {
        self.change(|view| view.update = update);
    }

    /// Shows whether a ready check is open; the app keeps the hotkey registered while it is (RDY-07).
    pub fn set_ready_check_open(&self, open: bool) {
        self.change(|view| view.ready_check_open = open);
    }

    /// Shows the accept hotkey the agent registers (RDY-07).
    pub fn set_hotkeys(&self, accept: &HotkeyChoice) {
        self.change(|view| view.hotkeys = HotkeysView::of(accept));
    }

    /// Shows why the OS did not let the agent register a hotkey it wants, or (`None`) that it holds it now (AST-08).
    /// An unchanged answer publishes nothing, so a retry that fails the same way does not publish again. Returns whether the
    /// view changed.
    pub fn set_hotkey_unavailable(&self, slot: HotkeySlot, reason: Option<HotkeyFailure>) -> bool {
        let wanted = reason.map(|reason| HotkeyFault { slot, reason });
        let unchanged = lock(&self.view)
            .hotkey_unavailable
            .iter()
            .find(|fault| fault.slot == slot)
            .copied()
            == wanted;
        if unchanged {
            return false;
        }
        self.change(|view| {
            view.hotkey_unavailable.retain(|fault| fault.slot != slot);
            view.hotkey_unavailable.extend(wanted);
        });
        true
    }

    /// Shows the last hotkey press the agent received (every press is published: it proves the OS delivers them).
    pub fn set_last_press(&self, press: HotkeyPress) {
        self.change(|view| view.last_press = Some(press));
    }

    /// Shows what the last look at the game read. An unchanged reading publishes nothing, so a once-a-second look does not
    /// publish once a second.
    pub fn set_diagnostics(&self, diagnostics: DiagnosticsView) {
        let unchanged = lock(&self.view).diagnostics.as_ref() == Some(&diagnostics);
        if !unchanged {
            self.change(|view| view.diagnostics = Some(diagnostics));
        }
    }

    /// Shows what the capture of the last look held. An unchanged reading publishes nothing.
    pub fn set_capture(&self, capture: CaptureView) {
        let unchanged = lock(&self.view).capture.as_ref() == Some(&capture);
        if !unchanged {
            self.change(|view| view.capture = Some(capture));
        }
    }

    /// Shows the version of the configuration the agent runs (RCF-08). An unchanged version publishes nothing.
    pub fn set_config_version(&self, version: u32) {
        let unchanged = lock(&self.view).config_version == version;
        if !unchanged {
            self.change(|view| view.config_version = version);
        }
    }

    pub fn snapshot(&self) -> AgentView {
        lock(&self.view).clone()
    }
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}
