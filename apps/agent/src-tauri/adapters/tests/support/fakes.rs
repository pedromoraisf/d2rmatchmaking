//! In-memory ports for the core tests: a token store that can refuse writes, a state sink that records every view, and a
//! process source and update checker with scripted answers.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use d2rmm_agent_core::ports::{
    ProcessSource, ReadError, Rgba, StateSink, StoreError, TextReader, TokenStore, UpdateChecker,
    UpdateOutcome,
};
use d2rmm_agent_core::secret::Secret;
use d2rmm_agent_core::view::{AgentView, PairingView};
use d2rmm_agent_domain::vision::{ReadText, Region};

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Holds the token in memory and counts what happened to it. `refuse_saves` makes the next writes fail.
#[derive(Debug, Default)]
pub struct FakeTokenStore {
    token: Mutex<Option<Secret>>,
    refusals: AtomicUsize,
    saves: AtomicUsize,
    deletes: AtomicUsize,
}

impl FakeTokenStore {
    pub fn with_token(token: Option<&str>) -> Self {
        Self {
            token: Mutex::new(token.map(Secret::new)),
            ..Self::default()
        }
    }

    /// The stored token text, for assertions only.
    pub fn stored(&self) -> Option<String> {
        lock(&self.token)
            .as_ref()
            .map(|token| token.expose().to_string())
    }

    pub fn refuse_saves(&self, count: usize) {
        self.refusals.store(count, Ordering::SeqCst);
    }

    pub fn save_calls(&self) -> usize {
        self.saves.load(Ordering::SeqCst)
    }

    pub fn delete_calls(&self) -> usize {
        self.deletes.load(Ordering::SeqCst)
    }
}

impl TokenStore for FakeTokenStore {
    fn load(&self) -> Option<Secret> {
        lock(&self.token).clone()
    }

    fn save(&self, token: &Secret) -> Result<(), StoreError> {
        self.saves.fetch_add(1, Ordering::SeqCst);
        let refused = self
            .refusals
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                left.checked_sub(1)
            })
            .is_ok();
        if refused {
            return Err(StoreError);
        }
        *lock(&self.token) = Some(token.clone());
        Ok(())
    }

    fn delete(&self) {
        self.deletes.fetch_add(1, Ordering::SeqCst);
        *lock(&self.token) = None;
    }
}

/// Keeps every view the agent published, in order.
#[derive(Debug, Default)]
pub struct RecordingSink {
    views: Mutex<Vec<AgentView>>,
}

impl RecordingSink {
    pub fn last(&self) -> Option<AgentView> {
        lock(&self.views).last().cloned()
    }

    pub fn pairing(&self) -> Option<PairingView> {
        self.last().map(|view| view.pairing)
    }

    pub fn pairing_history(&self) -> Vec<PairingView> {
        lock(&self.views)
            .iter()
            .map(|view| view.pairing.clone())
            .collect()
    }
}

impl StateSink for RecordingSink {
    fn publish(&self, view: AgentView) {
        lock(&self.views).push(view);
    }
}

/// A process snapshot the test sets by hand.
#[derive(Debug, Default)]
pub struct FakeProcesses {
    names: Mutex<Vec<String>>,
}

impl FakeProcesses {
    pub fn set(&self, names: &[&str]) {
        *lock(&self.names) = names.iter().map(|name| (*name).to_string()).collect();
    }
}

impl ProcessSource for FakeProcesses {
    fn names(&self) -> Vec<String> {
        lock(&self.names).clone()
    }
}

/// Reads the same text from any region and remembers the regions it was asked for.
#[derive(Debug)]
pub struct FakeReader {
    text: String,
    regions: Mutex<Vec<Region>>,
}

impl FakeReader {
    pub fn reading(text: &str) -> Self {
        Self {
            text: text.to_string(),
            regions: Mutex::new(Vec::new()),
        }
    }

    pub fn regions(&self) -> Vec<Region> {
        lock(&self.regions).clone()
    }
}

impl TextReader for FakeReader {
    fn read(&self, _image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
        lock(&self.regions).push(region);
        Ok(ReadText {
            text: self.text.clone(),
            confidence: 0.93,
        })
    }
}

/// Answers each check with the next scripted outcome, then "up to date".
#[derive(Debug, Default)]
pub struct FakeUpdater {
    outcomes: Mutex<VecDeque<UpdateOutcome>>,
    calls: AtomicUsize,
}

impl FakeUpdater {
    pub fn script(&self, outcomes: impl IntoIterator<Item = UpdateOutcome>) {
        lock(&self.outcomes).extend(outcomes);
    }

    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl UpdateChecker for FakeUpdater {
    async fn check(&self) -> UpdateOutcome {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let next = lock(&self.outcomes).pop_front();
        next.unwrap_or(UpdateOutcome::UpToDate)
    }
}
