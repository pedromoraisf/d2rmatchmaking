import { withSpan } from '../../../shared-kernel/index.ts';
import { matchesEtag } from '../domain/agent-config.ts';
import type { AgentConfigSource } from './ports.ts';

export type AgentConfigAnswer =
  /** The document, to send with its tag. */
  | { readonly status: 'ok'; readonly body: string; readonly etag: string }
  /** The caller holds this version already: no body. */
  | { readonly status: 'not-modified'; readonly etag: string }
  /** The API has no configuration to serve; the agent runs on its built-in values (RCF-06). */
  | { readonly status: 'none' };

export interface GetAgentConfigDeps {
  readonly configSource: AgentConfigSource;
}

/**
 * The remote configuration, the same bytes for every agent (RCF-01): no account or agent data enters the answer, so the
 * use case takes no identity. `ifNoneMatch` is the request header, compared with the tag of the served version.
 */
export function createGetAgentConfig(deps: GetAgentConfigDeps) {
  return (input: { readonly ifNoneMatch?: string | undefined }): Promise<AgentConfigAnswer> =>
    withSpan('agents.get-agent-config', {}, (): AgentConfigAnswer => {
      const served = deps.configSource.current();
      if (served === undefined) {
        return { status: 'none' };
      }
      if (matchesEtag(input.ifNoneMatch, served.etag)) {
        return { status: 'not-modified', etag: served.etag };
      }
      return { status: 'ok', body: served.body, etag: served.etag };
    });
}
