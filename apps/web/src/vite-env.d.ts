// The site's build-time settings as the site reads them from `import.meta.env` (design § Site telemetry, AD-098).
// `VITE_TELEMETRY` is `on` only in the builds that export spans (the e2e build); production leaves it unset.
// `VITE_TELEMETRY_RATIO` is the sampling ratio as text. Declared here rather than with `vite/client`, a dev dependency
// that the runtime sources may not import (rule no-dev-deps-in-runtime).
interface ImportMetaEnv {
  readonly MODE: string;
  readonly VITE_TELEMETRY?: string;
  readonly VITE_TELEMETRY_RATIO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// The theme's source, read as text by the contrast test (theme.test.ts).
declare module '*.css?raw' {
  const css: string;
  export default css;
}
