// The only reader of `process.env` in the staging bots (staging-bots SBT-12; AGENTS.md rule 13 III, the script's `main/`).
// Everything else takes its values as arguments. It reads two public URLs, the run's inputs and the summary path: no secret.

export function readConfig(env = process.env) {
  return {
    apiUrl: env.STAGING_API_URL,
    siteOrigin: env.SITE_ORIGIN,
    environment: env.D2RMM_ENV,
    summaryPath: env.GITHUB_STEP_SUMMARY,
    runId: env.GITHUB_RUN_ID ?? String(Date.now()),
    inputs: {
      mode: env.BOTS_MODE,
      difficulty: env.BOTS_DIFFICULTY,
      region: env.BOTS_REGION,
      ladder: env.BOTS_LADDER,
      era: env.BOTS_ERA,
      hardcore: env.BOTS_HARDCORE,
      activity: env.BOTS_ACTIVITY,
      role: env.BOTS_ROLE,
      rules: env.BOTS_RULES,
      min_level: env.BOTS_MIN_LEVEL,
      bots: env.BOTS_COUNT,
      minutes: env.BOTS_MINUTES,
      human_first: env.BOTS_HUMAN_FIRST,
      host_policy: env.BOTS_HOST_POLICY,
    },
  };
}

/** Two lowercase letters or digits from the run id, so a rerun with the same inputs gets other bot names. */
export function tagOf(runId) {
  const digits = String(runId)
    .replace(/[^0-9a-z]/gi, '')
    .toLowerCase();
  return (digits.slice(-2) || '00').padStart(2, '0');
}
