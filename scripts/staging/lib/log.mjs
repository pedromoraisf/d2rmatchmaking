// The structured log and the job summary of a run (staging-bots SBT-11). One JSON object per line on stdout (ADR 032 XI).
// Every value of a secret the run holds (a session cookie, an agent token) is registered here and blanked from every line
// and from the summary, so a code path that forgets to leave one out still leaks nothing.

export function createLog({ write, now = () => new Date() }) {
  const secrets = new Set();
  const scrub = (text) => {
    let clean = text;
    for (const secret of secrets) clean = clean.split(secret).join('[redacted]');
    return clean;
  };
  return {
    /** Registers a value that must never be printed. Short values are refused: they would blank ordinary words. */
    secret(value) {
      if (typeof value === 'string' && value.length >= 8) secrets.add(value);
    },
    line(event, fields = {}) {
      write(`${scrub(JSON.stringify({ at: now().toISOString(), event, ...fields }))}\n`);
    },
    scrub,
  };
}

/** The job summary: the bucket, the bots, the group, the room and how each bot left. Names and ids only. */
export function summaryOf({ plan, outcomes, scrub }) {
  const lines = [
    '## Staging bots',
    '',
    `- Mode: ${plan.queue.mode}, difficulty ${plan.queue.difficulty}, region ${plan.queue.region}`,
    `- Declared: ${plan.bots[0].declaration.ladder}, ${plan.bots[0].declaration.era}`,
    `- Bots: ${plan.bots.map((bot) => bot.name).join(', ')}`,
    `- Human first: ${plan.humanFirst}; host policy: ${plan.hostPolicy}; stay: ${plan.minutes} min`,
    '',
    '| Bot | Room | Stages | Left |',
    '| --- | --- | --- | --- |',
    ...outcomes.map(
      (outcome) =>
        `| ${outcome.name} | ${outcome.room ?? '—'} | ${(outcome.stages ?? []).join(' → ') || '—'} | ${outcome.left} |`,
    ),
    '',
  ];
  return scrub(lines.join('\n'));
}
