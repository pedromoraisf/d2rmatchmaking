// The agent window's text rules as pure functions (design.md § UI; AGS-05, AGS-31, AGS-32). The core decides every state
// and publishes it as one AgentView; this file names the translation key that renders each state, so the window holds
// no rule of its own.

export type PairingState =
  | 'requesting'
  | { showingCode: { code: string; minutesLeft: number } }
  | 'paused'
  | 'rateLimited'
  | 'unreachable'
  | 'saveFailed'
  | 'paired';

export type Connectivity = 'connected' | 'unreachable';

export type UpdateState = 'idle' | 'failed' | 'required';

export interface RoomState {
  gameName: string;
  // The Party panel showed the masked game name and no match has come yet (AGN-04).
  needsReveal: boolean;
  // The Party panel showed the expected game name in this run (AGN-03).
  matched: boolean;
  // The API accepted the observation for the held run (ARL-03). The core omits it while false.
  confirmed?: boolean;
}

export interface RejectedSlot {
  slot: number;
  // A short code (`name-disagree`, `level-unread`…): never the text the screen showed.
  reason: string;
}

// What the last look at the game window read: counts, the frame size and codes, shown in the window only.
export interface Diagnostics {
  screen: 'unknown' | 'characterSelect' | 'inGame' | 'automapOpen';
  frameWidth: number;
  frameHeight: number;
  cardsRead: number;
  cardsSettled: number;
  // How many popup options were found by their word (0 to 3): a count, never a text.
  popupOptionsFound: number;
  rejected: RejectedSlot[];
  // `not-sent`, `ok` or the kind of the error the last post carried.
  post: string;
}

// What the last Party look saw, as state: never the text the field showed.
export interface PartyLook {
  panelOpen: boolean;
  field: 'notRead' | 'empty' | 'masked' | 'text';
  matched: boolean;
  // How the field was read; absent or null when it was not.
  detail?: FieldDetail | null;
}

// How the Game Name field was read: where, by how many OCR variants and, for another name, the edit operations of the
// closest variant against the expected name (`sub(l>9)@9`, `?` for a character outside [a-z0-9 -], `far`, `same`).
export interface FieldDetail {
  source: 'label' | 'labelLine' | 'layoutBox';
  variants: number;
  diff: string | null;
}

// What the capture itself holds: numbers and booleans, never a pixel (the geometry-or-blank-frame check).
export interface CaptureDiagnostics {
  brightness: number;
  blank: boolean;
  windowWidth: number | null;
  windowHeight: number | null;
  party: PartyLook | null;
  // The method that gave the last usable frame, as the core's fixed word, or `none` (capture-cascade CAP-07).
  method: CaptureMethodWord;
  // The usable share of the last looks, a whole percent.
  readRatePercent: number;
  // Present when the game runs and no method gave a usable frame (CAP-02).
  reason?: 'nothing';
}

export type CaptureMethodWord = 'print-window' | 'graphics-capture' | 'screen-crop' | 'none';

// The key of each capture method's name in the locale files.
const METHOD_KEYS: Record<CaptureMethodWord, string> = {
  'print-window': 'diagnostics.capture.method.printWindow',
  'graphics-capture': 'diagnostics.capture.method.graphicsCapture',
  'screen-crop': 'diagnostics.capture.method.screenCrop',
  none: 'diagnostics.capture.method.none',
};

export interface Hotkeys {
  accept: string;
  fill: string;
}

// What a press of the fill hotkey did: a closed set of codes from the core (AST-08, AST-10).
export type FillOutcome =
  | 'typed'
  | 'stopped-focus'
  | 'stopped-room'
  | 'stopped-press'
  | 'refused-room'
  | 'refused-name'
  | 'refused-focus'
  | 'refused-screen'
  | 'refused-keys';

export interface AgentView {
  pairing: PairingState;
  connectivity: Connectivity;
  room: RoomState | null;
  update: UpdateState;
  // A ready check is open for the account: the hotkey that accepts it is registered (RDY-07).
  readyCheckOpen: boolean;
  // The keys that accept a ready check and fill the game name (RDY-07, AST-01), as the core spells them.
  hotkeys: Hotkeys;
  // What the last press of the fill hotkey did (AST-08); absent before the first press.
  lastFill?: FillOutcome;
  diagnostics: Diagnostics | null;
  // Absent until the first frame was captured.
  capture?: CaptureDiagnostics;
}

export interface Label {
  key: string;
  values?: Record<string, string | number>;
}

export type Translate = (key: string, values?: Record<string, string | number>) => string;

type PairingWord = Exclude<PairingState, { showingCode: { code: string; minutesLeft: number } }>;

// The core's unit pairing states and the key of each. Unreachable reuses the connectivity text (AGS-11).
const PAIRING_KEYS: Record<PairingWord, string> = {
  requesting: 'pairing.requesting',
  paused: 'pairing.paused',
  rateLimited: 'pairing.rateLimited',
  unreachable: 'connectivity.unreachable',
  saveFailed: 'pairing.saveFailed',
  paired: 'pairing.paired',
};

// The text of a pairing state, or null when the view shows the code itself (`showingCode`).
export function pairingLabel(pairing: PairingState): Label | null {
  if (typeof pairing === 'object') {
    return null;
  }
  return { key: PAIRING_KEYS[pairing] };
}

// Only the paused state offers "Get a new code" (AGS-34). A rate limit offers none (AGS-35).
export function offersNewCode(pairing: PairingState): boolean {
  return pairing === 'paused';
}

export function connectivityLabel(connectivity: Connectivity): Label {
  return { key: connectivity === 'connected' ? 'connectivity.connected' : 'connectivity.unreachable' };
}

export function roomLabel(room: RoomState | null): Label | null {
  if (room === null) {
    return null;
  }
  const key = room.confirmed === true ? 'room.confirmed' : 'room.waiting';
  return { key, values: { gameName: room.gameName } };
}

// The hint to reveal the game name: shown while the agent holds the room, the Party panel showed the masked name and no
// match has come for this run (AGN-04).
export function revealLabel(room: RoomState | null): Label | null {
  return room !== null && room.needsReveal && !room.matched ? { key: 'room.revealHint' } : null;
}

// The hotkey line while a ready check is open (RDY-07, en and pt-BR): the window names the key, and only while it is open.
export function readyCheckLabel(open: boolean, hotkeys: Hotkeys): Label | null {
  return open ? { key: 'readyCheck.hotkey', values: { key: hotkeys.accept } } : null;
}

// The line that says how to fill the game name while the agent holds a room (AST-01).
export function fillHintLabel(room: RoomState | null, hotkeys: Hotkeys): Label | null {
  return room === null ? null : { key: 'fill.hint', values: { key: hotkeys.fill } };
}

// What the last press of the fill hotkey did, one line per outcome; a full fill reminds the player to confirm (AST-08).
export function fillLabel(outcome: FillOutcome | undefined): Label | null {
  return outcome === undefined ? null : { key: `fill.${outcome}` };
}

// The lines of the diagnostics section, one label each, in the order the window shows them.
export function diagnosticsLabels(diagnostics: Diagnostics): Label[] {
  return [
    { key: `diagnostics.screen.${diagnostics.screen}` },
    {
      key: 'diagnostics.frame',
      values: { width: diagnostics.frameWidth, height: diagnostics.frameHeight },
    },
    { key: 'diagnostics.cards', values: { read: diagnostics.cardsRead, settled: diagnostics.cardsSettled } },
    { key: 'diagnostics.popup', values: { found: diagnostics.popupOptionsFound } },
    ...diagnostics.rejected.map((rejected) => ({
      key: 'diagnostics.rejected',
      values: { slot: rejected.slot + 1, reason: rejected.reason },
    })),
    postLabel(diagnostics.post),
  ];
}

// The outcomes of the last character post the core publishes (`error_kind` and the two answers of `watch_screen`).
const POST_OUTCOMES = new Set([
  'not-sent',
  'ok',
  'unauthorized',
  'upgrade-required',
  'rate-limited',
  'gone',
  'pending',
  'server',
  'network',
  'invalid',
  'check-ended',
]);

// The "Last send" line: a known outcome has its own translated line; one this build does not know shows its code.
function postLabel(outcome: string): Label {
  return POST_OUTCOMES.has(outcome)
    ? { key: `diagnostics.post.${outcome}` }
    : { key: 'diagnostics.post.other', values: { outcome } };
}

// The capture lines of the diagnostics: the window size beside the frame (client) size, the frame content and the last Party
// look of the held run. Shown after the lines `diagnosticsLabels` gives.
export function captureLabels(capture: CaptureDiagnostics): Label[] {
  const labels: Label[] = [{ key: METHOD_KEYS[capture.method] }];
  if (capture.reason === 'nothing') {
    labels.push({ key: 'diagnostics.capture.nothing' });
  } else if (capture.method !== 'none') {
    labels.push({ key: 'diagnostics.capture.rate', values: { percent: capture.readRatePercent } });
  }
  if (capture.windowWidth !== null && capture.windowHeight !== null) {
    labels.push({
      key: 'diagnostics.window',
      values: { width: capture.windowWidth, height: capture.windowHeight },
    });
  }
  labels.push(
    capture.blank
      ? { key: 'diagnostics.content.blank', values: { brightness: capture.brightness } }
      : { key: 'diagnostics.content.drawn', values: { brightness: capture.brightness } },
  );
  labels.push(partyLabel(capture.party));
  labels.push(...partyDetailLabels(capture.party));
  return labels;
}

function partyLabel(party: PartyLook | null): Label {
  if (party === null) {
    return { key: 'diagnostics.party.none' };
  }
  if (!party.panelOpen) {
    return { key: 'diagnostics.party.closed' };
  }
  if (party.matched) {
    return { key: 'diagnostics.party.matched' };
  }
  return { key: `diagnostics.party.${party.field}` };
}

function partyDetailLabels(party: PartyLook | null): Label[] {
  const detail = party?.detail;
  if (!party || !party.panelOpen || !detail) {
    return [];
  }
  const labels: Label[] = [
    {
      key: `diagnostics.party.source.${detail.source}`,
      values: { variants: detail.variants },
    },
  ];
  if (detail.diff !== null) {
    labels.push(
      detail.diff === 'far' || detail.diff === 'same'
        ? { key: `diagnostics.party.closest.${detail.diff}` }
        : { key: 'diagnostics.party.closest.edits', values: { edits: detail.diff } },
    );
  }
  return labels;
}

export function updateLabel(update: UpdateState): Label | null {
  switch (update) {
    case 'idle':
      return null;
    case 'failed':
      return { key: 'update.failed' };
    case 'required':
      return { key: 'update.required' };
  }
}

export function translateLabel(translate: Translate, label: Label): string {
  return translate(label.key, label.values);
}
