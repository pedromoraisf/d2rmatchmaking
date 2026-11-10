// Wire primitives shared by the HTTP and stream schemas (ADR 009: one Zod source for TypeScript, JSON Schema and Rust).
// Ids are opaque strings: the Design Doc examples use short ids such as "4821".
import { z } from 'zod';

export const Id = z.string().min(1).max(64);
export const IsoDateTime = z.iso.datetime();
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/);
export const Screen = z.enum(['UNKNOWN', 'CHARACTER_SELECT', 'IN_GAME', 'AUTOMAP_OPEN']);
export const Mode = z.enum(['pvp', 'leveling']);
export const Difficulty = z.enum(['normal', 'nightmare', 'hell']);
export const RoomStage = z.enum(['formed', 'awaiting_host', 'created', 'active', 'closed', 'expired']);
export const Role = z.enum(['host', 'member']);
export const GameName = z
  .string()
  .regex(/^mm[a-z]+-\d+$/)
  .max(64);

export const Member = z.object({
  accountId: Id,
  characterId: Id.nullable(),
  joinOrder: z.number().int().min(1),
  role: Role,
});
export type Member = z.infer<typeof Member>;
