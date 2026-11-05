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
}

export interface AgentView {
  pairing: PairingState;
  connectivity: Connectivity;
  room: RoomState | null;
  update: UpdateState;
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
