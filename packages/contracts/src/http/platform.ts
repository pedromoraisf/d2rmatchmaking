// Identity, configuration and error schemas shared by the site routes.
import { z } from 'zod';
import { Id, SemVer } from './common.ts';

export const TestLoginRequest = z.object({
  name: z.string().max(64),
});
export type TestLoginRequest = z.infer<typeof TestLoginRequest>;

// The staging match body (`POST /v1/staging/match-formed`): the empty JSON object the same-origin guard requires.
export const MatchFormedRequest = z.object({});
export type MatchFormedRequest = z.infer<typeof MatchFormedRequest>;

export const MeResponse = z.object({
  accountId: Id,
  displayName: z.string().max(64),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const ConfigResponse = z.object({
  stagingEndpoints: z.boolean(),
  minAgentVersion: SemVer,
});
export type ConfigResponse = z.infer<typeof ConfigResponse>;

export const ErrorResponse = z.object({
  error: z.string().min(1).max(64),
  fields: z.array(z.string()).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// The telemetry relay's answers (`POST /v1/telemetry/traces`, OBS-42). `202` has no content: the relay never returns what the
// backend answered. Every other status is the shared error body, with `429` for the rate and budget refusals.
export const RelayAccepted = z.undefined();
export type RelayAccepted = z.infer<typeof RelayAccepted>;
