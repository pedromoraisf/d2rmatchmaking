// Maps queue values to translation keys, so the site never shows a raw enum (AWS-14, AWS-21, AWS-23, NFR-12).
import type { QueueLeaveReason } from '@d2rmm/contracts';
import type { EntryReason } from './entry-reason.ts';

export type QueueRegionValue = 'americas' | 'europe' | 'asia';
export type QueueFormatValue = 'duel' | '2v2' | 'arena';
export type QueueRulesValue = 'gm' | 'bm';
export type QueueActivityValue = 'baal' | 'chaos' | 'cows' | 'tz' | 'heralds';
export type QueueRoleValue = 'teleporter' | 'bo' | 'killer' | 'leech';

export const regionKey = (region: QueueRegionValue): string => `queue.regions.${region}`;
export const formatKey = (format: QueueFormatValue): string => `queue.formats.${format}`;
export const rulesKey = (rules: QueueRulesValue): string => `queue.rulesOptions.${rules}`;
export const activityKey = (activity: QueueActivityValue): string => `queue.activities.${activity}`;
export const roleKey = (role: QueueRoleValue): string => `queue.roles.${role}`;
export const reasonKey = (reason: EntryReason): string => `queue.reasons.${reason}`;

/** The notices the site shows for a ticket that left on its own (QUE-14). A player's own leave and a match show none. */
export const leftNoticeKey = (reason: Exclude<QueueLeaveReason, 'left-by-player' | 'matched'>): string =>
  `queue.left.${reason}`;
