// Agent-facing and site-facing schemas of the Agents context (pairing, claim, heartbeat, presence).
import { z } from 'zod';
import { Id, IsoDateTime, Screen, SemVer } from './common.ts';

export const PairingCodeResponse = z.object({
  code: z.string().regex(/^\d{6}$/),
  expiresAt: IsoDateTime,
  claimSecret: z.string().min(1).max(128),
});
export type PairingCodeResponse = z.infer<typeof PairingCodeResponse>;

// The site's pairing body (`POST /v1/agents/pair`). Any value that matches no unused code answers 400 `invalid-code`.
export const PairRequest = z.object({
  code: z.string().min(1).max(16),
});
export type PairRequest = z.infer<typeof PairRequest>;

export const ClaimRequest = z.object({
  claimSecret: z.string().min(1).max(128),
});
export type ClaimRequest = z.infer<typeof ClaimRequest>;

export const ClaimResponse = z.object({
  token: z.string().regex(/^d2rmm_a_[A-Za-z0-9_-]{43}$/),
});
export type ClaimResponse = z.infer<typeof ClaimResponse>;

export const PcState = z.enum(['IDLE', 'IN_QUEUE', 'IN_ROOM_JOINING', 'IN_GAME']);

export const Heartbeat = z.object({
  agentVersion: SemVer,
  pcState: PcState,
  game: z.object({
    running: z.boolean(),
    window: z.string().max(32),
    screen: Screen,
  }),
  assignment: z
    .object({ roomId: Id, run: z.number().int().min(1) })
    .nullable()
    .optional(),
  capture: z.object({
    method: z.string().max(32),
    readRate: z.number().min(0).max(1),
  }),
});
export type Heartbeat = z.infer<typeof Heartbeat>;

export const AgentView = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({
    status: z.literal('paired'),
    agentId: Id,
    online: z.boolean(),
    gameRunning: z.boolean(),
    screen: Screen,
    lastSeenAt: IsoDateTime.nullable(),
  }),
]);
export type AgentView = z.infer<typeof AgentView>;
