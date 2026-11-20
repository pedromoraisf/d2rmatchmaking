// The keep-awake window (ADR 033, DLP-07): production is pinged only inside a daily window, so the free service sleeps
// the rest of the day and staging and the previews fit in Render's 750 instance-hours. The rule is pure; the CLI is what
// keep-awake.yml calls before it pings.
import { fileURLToPath } from 'node:url';

/** The window used when the variable is unset: 10 hours a day, about 310 hours a month. */
export const DEFAULT_WINDOW = '16:00-02:00 America/Sao_Paulo';
const PATTERN = /^([01][0-9]|2[0-3]):([0-5][0-9])-([01][0-9]|2[0-3]):([0-5][0-9]) ([A-Za-z0-9_+\-/]+)$/;

/** `HH:MM-HH:MM <IANA zone>` as `{ startMinute, endMinute, zone }`, or undefined when malformed, empty or of no length. */
export function parseWindow(text) {
  const match = PATTERN.exec(String(text ?? '').trim());
  if (match === null) return undefined;
  const startMinute = Number(match[1]) * 60 + Number(match[2]);
  const endMinute = Number(match[3]) * 60 + Number(match[4]);
  if (startMinute === endMinute) return undefined;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: match[5] });
  } catch {
    return undefined;
  }
  return { startMinute, endMinute, zone: match[5] };
}

/** The minute of the day (0 to 1439) of `now` in `zone`. */
export function minuteOfDay(now, zone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
  return part('hour') * 60 + part('minute');
}

/**
 * Whether `now` is inside `window` (the text of the variable; unset, empty or malformed means the default). The start is
 * inside and the end is not; a window whose end is before its start crosses midnight.
 */
export function isInsideWindow(now, window) {
  const rule = parseWindow(window) ?? parseWindow(DEFAULT_WINDOW);
  const minute = minuteOfDay(now, rule.zone);
  return rule.startMinute < rule.endMinute
    ? minute >= rule.startMinute && minute < rule.endMinute
    : minute >= rule.startMinute || minute < rule.endMinute;
}

/**
 * The exact origin of `value` when it is an `https://` origin (a host, an optional port, at most a trailing slash), else
 * undefined: no other scheme, no user info, no path, query or fragment. keep-awake pings only an origin it accepts, so a
 * mistyped or hostile variable cannot send the ping elsewhere.
 */
export function httpsOrigin(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return undefined;
  }
  const clean =
    url.protocol === 'https:' &&
    url.hostname !== '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '';
  return clean ? url.origin : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `awake-window.mjs [window] [url]`: prints `inside=true|false` and `target=<https origin>|` (lines for $GITHUB_OUTPUT).
  const text = process.argv[2] ?? '';
  const url = process.argv[3] ?? '';
  const target = httpsOrigin(url);
  if (url.trim() !== '' && target === undefined) {
    process.stderr.write('::warning::PRODUCTION_API_URL is not an https:// origin; nothing is pinged\n');
  }
  if (text.trim() !== '' && parseWindow(text) === undefined) {
    process.stderr.write(
      `::warning::KEEP_AWAKE_WINDOW is not "HH:MM-HH:MM <zone>"; using ${DEFAULT_WINDOW}\n`,
    );
  }
  process.stdout.write(`inside=${isInsideWindow(new Date(), text)}\ntarget=${target ?? ''}\n`);
}
