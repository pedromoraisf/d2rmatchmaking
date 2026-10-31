import type { RandomSource } from '../../../shared-kernel/index.ts';

/** `d2rmm_a_` followed by 32 random bytes in base64url: the agent token, returned once on claim. */
export function newAgentToken(random: RandomSource): string {
  return `d2rmm_a_${Buffer.from(random.bytes(32)).toString('base64url')}`;
}

/** `d2rmm_c_` followed by 32 random bytes in base64url: the claim secret the agent keeps until it claims its token. */
export function newClaimSecret(random: RandomSource): string {
  return `d2rmm_c_${Buffer.from(random.bytes(32)).toString('base64url')}`;
}
