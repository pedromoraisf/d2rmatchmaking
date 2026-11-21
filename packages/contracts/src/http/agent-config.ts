// The remote configuration of the desktop agent (RCF-02, RCF-03; ADR 010, ADR 009): one JSON document of bounded data.
// Every object is closed, every number has a range, every phrase is a short literal. No field names an action: no
// command, path, URL, script, key or pattern (AGT-04, RCF-10). The agent never trusts these ranges: it clamps a number
// into its own (`domain/src/remote_config.rs`); the ranges here are the API's own validation of the file it serves.
import { z } from 'zod';

/** The body of the configuration is at most 64 KiB (RCF-02). The API refuses to serve a file over it, the agent a body. */
export const AGENT_CONFIG_MAX_BYTES = 65536;

/** The range of every number of the document, `[min, max]` inclusive. One table for the schema and its tests. */
export const AGENT_CONFIG_RANGES = {
  /** Looks without a capture reading before the capture cascade demotes its method (capture cascade `DEMOTE_AFTER`). */
  demoteAfter: { min: 1, max: 10 },
  /** Looks between two probes of the better capture method (`PROBE_EVERY`); the floor is today's value, so no configuration makes more captures than today (RCF-09). */
  probeEvery: { min: 60, max: 600 },
  /** The window of looks the read rate is measured over (`RATE_WINDOW`). */
  rateWindow: { min: 10, max: 600 },
  /** Milliseconds between two looks at the game (`TICK`); the floor keeps CHR-03's at most one look per second. */
  lookIntervalMs: { min: 1000, max: 10000 },
  /** The padding, in pixels of the reference client, around the HUD track (`TRACK_PAD`). */
  trackPad: { min: 8, max: 48 },
  /** The fractions of a reading area: where it starts and how large it is. A size under the floor reads nothing. */
  regionOrigin: { min: 0, max: 1 },
  regionSize: { min: 0.02, max: 1 },
} as const;

/** The longest phrase, in characters (RCF-03). */
export const AGENT_CONFIG_PHRASE_MAX = 40;

// Letters of the supported languages (English, Portuguese), digits and spaces: no punctuation, so no pattern, escape,
// command, path or URL can be written (RCF-03, RCF-10). Latin-1 letters are written as escapes so the JSON Schema is ASCII.
const PHRASE_PATTERN = /^[A-Za-z0-9 À-ÖØ-öø-ÿ]+$/;

const Phrase = z.string().min(1).max(AGENT_CONFIG_PHRASE_MAX).regex(PHRASE_PATTERN);

const ranged = (range: { readonly min: number; readonly max: number }) =>
  z.number().int().min(range.min).max(range.max).optional();

/** A reading area as fractions of the reference client, inside the client with a minimum size (RCF-05). */
export const AgentConfigRegion = z
  .object({
    x: z.number().min(AGENT_CONFIG_RANGES.regionOrigin.min).max(AGENT_CONFIG_RANGES.regionOrigin.max),
    y: z.number().min(AGENT_CONFIG_RANGES.regionOrigin.min).max(AGENT_CONFIG_RANGES.regionOrigin.max),
    width: z.number().min(AGENT_CONFIG_RANGES.regionSize.min).max(AGENT_CONFIG_RANGES.regionSize.max),
    height: z.number().min(AGENT_CONFIG_RANGES.regionSize.min).max(AGENT_CONFIG_RANGES.regionSize.max),
  })
  .strict()
  .refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1, {
    message: 'the region lies outside the client',
  });
export type AgentConfigRegion = z.infer<typeof AgentConfigRegion>;

/** The words of one language the reading looks for (the Party panel's words), literals only. */
export const AgentConfigWords = z
  .object({
    party: Phrase.optional(),
    gameName: Phrase.optional(),
    password: Phrase.optional(),
  })
  .strict();
export type AgentConfigWords = z.infer<typeof AgentConfigWords>;

export const AgentConfig = z
  .object({
    /** A whole number that only grows; `0` is the agent's built-in defaults, so a served document starts at 1. */
    version: z.number().int().min(1).max(2147483647),
    cadence: z
      .object({
        demoteAfter: ranged(AGENT_CONFIG_RANGES.demoteAfter),
        probeEvery: ranged(AGENT_CONFIG_RANGES.probeEvery),
        rateWindow: ranged(AGENT_CONFIG_RANGES.rateWindow),
        lookIntervalMs: ranged(AGENT_CONFIG_RANGES.lookIntervalMs),
      })
      .strict()
      .optional(),
    thresholds: z
      .object({
        trackPad: ranged(AGENT_CONFIG_RANGES.trackPad),
      })
      .strict()
      .optional(),
    regions: z
      .object({
        hudBand: AgentConfigRegion.optional(),
        automapArea: AgentConfigRegion.optional(),
        partyArea: AgentConfigRegion.optional(),
      })
      .strict()
      .optional(),
    phrases: z
      .object({
        en: AgentConfigWords.optional(),
        'pt-BR': AgentConfigWords.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AgentConfig = z.infer<typeof AgentConfig>;

/** `GET /v1/agents/config`: the same document for every agent. */
export const AgentConfigResponse = AgentConfig;
export type AgentConfigResponse = AgentConfig;
