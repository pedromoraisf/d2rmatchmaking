// The committed configuration document (RCF-12, ADR 032 III and V): one JSON file in the repository, validated against
// the contract's `AgentConfig` when the process starts. A file that fails stops the start; a change is a reviewed commit
// and a release, never an edit on a server. Validation lives here, in an adapter, because only adapters import contracts.
import { readFileSync } from 'node:fs';
import { AGENT_CONFIG_MAX_BYTES, AgentConfig } from '@d2rmm/contracts';
import { err, ok, type Result } from '../../../../shared-kernel/index.ts';
import { servedConfigOf, type ServedAgentConfig } from '../../domain/agent-config.ts';

/** The committed document of the Agents module. */
export const AGENT_CONFIG_FILE = new URL('../../config/agent-config.json', import.meta.url);

/** Why a document was refused, in words that name the problem and never echo the document. */
export type AgentConfigFileError = 'too-large' | 'not-json' | 'invalid';

/** Validates the text of a document and binds the bytes to serve to its version. */
export function parseAgentConfig(text: string): Result<ServedAgentConfig, AgentConfigFileError> {
  if (Buffer.byteLength(text, 'utf8') > AGENT_CONFIG_MAX_BYTES) {
    return err('too-large');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err('not-json');
  }
  const parsed = AgentConfig.safeParse(json);
  if (!parsed.success) {
    return err('invalid');
  }
  const body = JSON.stringify(parsed.data);
  if (Buffer.byteLength(body, 'utf8') > AGENT_CONFIG_MAX_BYTES) {
    return err('too-large');
  }
  return ok(servedConfigOf(parsed.data.version, body));
}

/** Reads and validates the committed file once. Throws when it cannot be served, so the process does not start (RCF-12). */
export function loadAgentConfig(file: URL | string = AGENT_CONFIG_FILE): ServedAgentConfig {
  const parsed = parseAgentConfig(readFileSync(file, 'utf8'));
  if (!parsed.ok) {
    throw new Error(`the agent configuration file is refused (${parsed.error}): ${String(file)}`);
  }
  return parsed.value;
}
