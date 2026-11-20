// Whether the latest agent installer is code-signed (agent-release AGR-09). One build-time setting, `VITE_INSTALLER_SIGNED`,
// set to `true` in the same change that turns on `SIGNPATH_ENABLED`, so the site never calls an unsigned installer signed.
// Unset or anything else reads as unsigned, which keeps the SmartScreen note (ADR 016).

/** The build-time setting this module reads, typed as Vite types `import.meta.env`. */
export interface InstallerEnv {
  readonly VITE_INSTALLER_SIGNED?: string;
}

export function installerIsSigned(env: InstallerEnv): boolean {
  return env.VITE_INSTALLER_SIGNED === 'true';
}
