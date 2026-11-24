// The Render root refuses to expose the staging endpoints (and so the bots' test sign-in) anywhere but staging
// (staging-bots SBT-03, AWS-31): the production service starts with them off, and cannot start with them on.
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { refusalOf } from './render.ts';

const DATABASE_URL = 'postgres://user:pw@example.invalid/db';

describe('refusalOf (SBT-03)', () => {
  it('refuses the staging endpoints on a production service', () => {
    const config = loadConfig({ D2RMM_ENV: 'production', ENABLE_STAGING_ENDPOINTS: 'true', DATABASE_URL });
    expect(refusalOf(config)).toBe('ENABLE_STAGING_ENDPOINTS=true needs D2RMM_ENV=staging');
  });

  it('refuses the staging endpoints when the environment is not named at all', () => {
    const config = loadConfig({ ENABLE_STAGING_ENDPOINTS: 'true', DATABASE_URL });
    expect(refusalOf(config)).toBe('ENABLE_STAGING_ENDPOINTS=true needs D2RMM_ENV=staging');
  });

  it('lets production start with the endpoints off, and staging with them on', () => {
    expect(
      refusalOf(loadConfig({ D2RMM_ENV: 'production', ENABLE_STAGING_ENDPOINTS: 'false', DATABASE_URL })),
    ).toBeUndefined();
    expect(
      refusalOf(loadConfig({ D2RMM_ENV: 'staging', ENABLE_STAGING_ENDPOINTS: 'true', DATABASE_URL })),
    ).toBeUndefined();
  });

  it('refuses the acceptance test controls on Render, whatever the environment', () => {
    const config = loadConfig({ D2RMM_ENV: 'staging', D2RMM_ACCEPTANCE: 'false', DATABASE_URL });
    expect(refusalOf(config)).toBe('D2RMM_ACCEPTANCE is set: the test controls never run on Render');
  });
});
