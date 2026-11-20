// The Tauri `--config` override of an agent channel (ADR 033, DLP-06). `apps/agent/src-tauri/channels.json` is the one table
// of identifier, product name and updater per channel; the app crate (`src/channel.rs`) reads the same file, so what the
// installer is called and what the app does at run time cannot drift. The updater artifacts (a signed bundle for the
// updater) are made only where the updater is on.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CHANNEL_NAMES = ['preview', 'staging', 'production'];
const TABLE = new URL('../../apps/agent/src-tauri/channels.json', import.meta.url);

/** The channel table, read from channels.json. */
export function readChannels(file = TABLE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The override for `tauri build --config`: identifier, product name and whether updater artifacts are made. */
export function channelConfig(channel, table = readChannels()) {
  if (!CHANNEL_NAMES.includes(channel)) {
    throw new Error(`"${channel}" is not a channel (${CHANNEL_NAMES.join(', ')})`);
  }
  const entry = table[channel];
  if (
    typeof entry?.identifier !== 'string' ||
    typeof entry?.productName !== 'string' ||
    typeof entry?.updater !== 'boolean'
  ) {
    throw new Error(`channels.json has no complete entry for "${channel}"`);
  }
  return {
    identifier: entry.identifier,
    productName: entry.productName,
    bundle: { createUpdaterArtifacts: entry.updater },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `agent-channel.mjs <channel>`: prints the JSON for `--config`, or exits 1.
  try {
    process.stdout.write(`${JSON.stringify(channelConfig(process.argv[2]))}\n`);
  } catch (error) {
    process.stderr.write(`::error::${error.message}\n`);
    process.exit(1);
  }
}
