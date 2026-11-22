import { describe, expect, it } from 'vitest';
import { ACTIVE_SPAN_DETAIL, NO_SPAN_DETAIL } from '../shared-kernel/index.ts';
import { spanDetailFor } from './span-detail.ts';

describe('spanDetailFor (OBT-01, OBT-04)', () => {
  it('records in the full tier and in none other, an unknown tier included', () => {
    expect(spanDetailFor('full')).toBe(ACTIVE_SPAN_DETAIL);
    expect(spanDetailFor('production')).toBe(NO_SPAN_DETAIL);
    expect(spanDetailFor(undefined)).toBe(NO_SPAN_DETAIL);
  });
});
