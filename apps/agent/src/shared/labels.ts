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
  rejected: RejectedSlot[];
  // `not-sent`, `ok` or the kind of the error the last post carried.
  post: string;
}

export interface AgentView {
  pairing: PairingState;
  connectivity: Connectivity;
  room: RoomState | null;
  update: UpdateState;
  // A ready check is open for the account: the hotkey that accepts it is registered (RDY-07).
  readyCheckOpen: boolean;
  diagnostics: Diagnostics | null;
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
  return room === null ? null : { key: 'room.waiting', values: { gameName: room.gameName } };
}

// The hint to reveal the game name: shown while the agent holds the room, the Party panel showed the masked name and no
// match has come for this run (AGN-04).
export function revealLabel(room: RoomState | null): Label | null {
  return room !== null && room.needsReveal && !room.matched ? { key: 'room.revealHint' } : null;
}

// The hotkey line while a ready check is open (RDY-07, en and pt-BR): the window names the key, and only while it is open.
export function readyCheckLabel(open: boolean): Label | null {
  return open ? { key: 'readyCheck.hotkey' } : null;
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
    ...diagnostics.rejected.map((rejected) => ({
      key: 'diagnostics.rejected',
      values: { slot: rejected.slot + 1, reason: rejected.reason },
    })),
    { key: 'diagnostics.post', values: { outcome: diagnostics.post } },
  ];
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
