// The ended rooms this browser put away (ARL-05). Kept in `localStorage` only, by room id: no account data, no server
// state and no new route. The list is capped so it never grows without bound.

const KEY = 'd2rmm.dismissed-rooms';
const LIMIT = 20;

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether this browser put the room away. A browser that refuses storage remembers nothing. */
export function isRoomDismissed(roomId: string): boolean {
  return read().includes(roomId);
}

/** Remembers the room as put away, keeping the latest `LIMIT` ids. */
export function dismissRoom(roomId: string): void {
  try {
    const ids = [...read().filter((id) => id !== roomId), roomId].slice(-LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // The dismissal then lasts until the page reloads, which is the state it had before.
  }
}
