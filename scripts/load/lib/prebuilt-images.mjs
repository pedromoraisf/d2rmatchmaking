// The load run builds its two images unless the caller has already built them (UPK-06). The nightly's load job builds them
// with the Actions cache and then runs `pnpm test:load`; without this rule the run built both a second time. Pure: the
// orchestrator gives it the environment and what `docker image inspect` found.

/** The variable the nightly sets after its cached builds. Only the value `1` counts. */
export const PREBUILT_VARIABLE = 'LOAD_IMAGES_PREBUILT';

/**
 * True when the run may skip its own build: the caller said the images are prebuilt AND both tags exist locally. A flag
 * with a missing image builds anyway, so a local run and a half-prepared runner both stay correct.
 * @param {Record<string, string | undefined>} env
 * @param {{ api: boolean, k6: boolean }} present whether each local tag exists
 * @returns {boolean}
 */
export function useBuiltImages(env, present) {
  return env[PREBUILT_VARIABLE] === '1' && present.api === true && present.k6 === true;
}
