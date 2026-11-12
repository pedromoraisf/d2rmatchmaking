// A Render pull request preview copies the base service's environment, including the staging DATABASE_URL (ADR 030).
// It must not start until the preview workflow has pointed it at its own Neon branch and set the marker below.

export interface PreviewEnv {
  readonly IS_PULL_REQUEST?: string | undefined;
  readonly D2RMM_PREVIEW_DATABASE?: string | undefined;
}

/** The reason a pull request preview must not start yet, or undefined when it may. Reads no secret. */
export function previewRefusal(env: PreviewEnv): string | undefined {
  if (env.IS_PULL_REQUEST === 'true' && env.D2RMM_PREVIEW_DATABASE !== 'ready') {
    return 'a pull request preview waits for its own database (D2RMM_PREVIEW_DATABASE=ready)';
  }
  return undefined;
}
