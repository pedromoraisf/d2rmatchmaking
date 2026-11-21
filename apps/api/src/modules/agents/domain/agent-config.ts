// The remote configuration the API serves (RCF-01, RCF-12): the bytes of one validated document, its version and the
// ETag that names the version. The document is the same for every agent, so nothing here knows an account or an agent.

export interface ServedAgentConfig {
  /** The document's version: a whole number that only grows. */
  readonly version: number;
  /** The exact bytes served: the document serialised once, at start. */
  readonly body: string;
  /** The `ETag` of the version, quotes included. */
  readonly etag: string;
}

/**
 * The entity tag of a document: its version and a digest of its bytes, so a file edited without a version bump is a different
 * tag and never answers `304` to an agent that holds the old bytes. The digest is computed by the adapter (the domain has no
 * node builtins) and is only formatted here.
 */
export function etagOf(version: number, digest: string): string {
  return `"agent-config-v${version}-${digest}"`;
}

/** Binds a validated document's bytes to its version and its tag; `digest` is a hex digest of `body`. */
export function servedConfigOf(version: number, body: string, digest: string): ServedAgentConfig {
  return { version, body, etag: etagOf(version, digest) };
}

/** Whether an `If-None-Match` header names this tag (`*` or a list, with or without the weak mark). */
export function matchesEtag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  return ifNoneMatch
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === '*' || candidate === etag);
}
