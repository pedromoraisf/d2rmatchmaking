// Minimal ambient types so the acceptance package type-checks without @types/node (only env vars are used).
declare const process: { env: Record<string, string | undefined> };
