import { Agent } from '../domain/agent.ts';
import { PairingCode } from '../domain/pairing-code.ts';
import { rateLimitKey, IP_CODE_REQUESTS } from '../domain/sliding-window.ts';
import {
  err,
  ok,
  withSpan,
  type Clock,
  type IdGenerator,
  type RandomSource,
  type Result,
  type UnitOfWork,
} from '../../../shared-kernel/index.ts';
import type { PairingCodeRepository, AgentRepository, RateLimitStore, SecretHasher } from './ports.ts';
import { newClaimSecret } from './secret-tokens.ts';

const MAX_ISSUE_ATTEMPTS = 20;

export interface RequestPairingCodeDeps {
  readonly agents: AgentRepository;
  readonly codes: PairingCodeRepository;
  readonly rateLimits: RateLimitStore;
  readonly hasher: SecretHasher;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly ids: IdGenerator;
  readonly uow: UnitOfWork;
}

export interface PairingCodeIssued {
  readonly code: string;
  readonly expiresAt: Date;
  readonly claimSecret: string;
}

/** Issues a pairing code for a new, unpaired agent. Stores no account. At most 10 requests per IP per hour (AD-041). */
export function createRequestPairingCode(deps: RequestPairingCodeDeps) {
  return (input: { readonly ip: string }): Promise<Result<PairingCodeIssued, 'rate-limited'>> =>
    withSpan(
      'agents.request-pairing-code',
      {},
      async (): Promise<Result<PairingCodeIssued, 'rate-limited'>> => {
        const now = deps.clock.now();
        const key = `ip:${rateLimitKey(input.ip)}`;
        const timestamps = await deps.rateLimits.timestamps(key);
        if (IP_CODE_REQUESTS.check(timestamps, now).outcome === 'limited') {
          return err('rate-limited');
        }
        await deps.rateLimits.record(key, now);

        const agentId = deps.ids.next();
        const code = await issueFreeCode(deps, agentId, now);
        const claimSecret = newClaimSecret(deps.random);
        const agent = new Agent({ id: agentId, claimSecretHash: deps.hasher.hash('claim', claimSecret) });
        await deps.uow.run(async (tx) => {
          await deps.agents.insert(tx, agent);
          await deps.codes.insert(tx, code);
        });
        return ok({ code: code.code, expiresAt: code.expiresAt, claimSecret });
      },
    );
}

/** Draws codes until one does not clash with a pending (unused, unexpired) code of the same value. */
async function issueFreeCode(deps: RequestPairingCodeDeps, agentId: string, now: Date): Promise<PairingCode> {
  for (let attempt = 0; attempt < MAX_ISSUE_ATTEMPTS; attempt += 1) {
    const candidate = PairingCode.issue(agentId, deps.random, now);
    const clash = await deps.codes.findUnusedByCode(candidate.code);
    if (clash === null || clash.claimState(now) === 'gone') {
      return candidate;
    }
  }
  throw new Error('could not draw a free pairing code');
}
