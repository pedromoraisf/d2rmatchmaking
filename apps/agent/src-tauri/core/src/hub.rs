//! The agent view and the state sink (AGS-34). The hub owns the view, publishes every change once through the sink and
//! is the only owner of the sink. Loops and effects change the view through its setters.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::ports::StateSink;
use crate::view::{AgentView, Connectivity, DiagnosticsView, PairingView, RoomView, UpdateView};

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
                diagnostics: None,
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

    /// Shows what the last look at the game read. An unchanged reading publishes nothing, so a once-a-second look does not
    /// publish once a second.
    pub fn set_diagnostics(&self, diagnostics: DiagnosticsView) {
        let unchanged = lock(&self.view).diagnostics.as_ref() == Some(&diagnostics);
        if !unchanged {
            self.change(|view| view.diagnostics = Some(diagnostics));
        }
    }

    pub fn snapshot(&self) -> AgentView {
        lock(&self.view).clone()
    }
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}
