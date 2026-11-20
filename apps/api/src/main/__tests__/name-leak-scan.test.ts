import { describe, expect, it } from 'vitest';
import { distinctiveParts, findLeaks, type Observed } from './name-leak-scan.ts';

const empty: Observed = { spans: [], logs: [], responses: [], rows: [] };

describe('the leak scan itself', () => {
  it('keeps only the windows the stored spelling lacks', () => {
    expect(distinctiveParts('Gxzqy', 'Oxzqy')).toEqual(['gxz']);
  });

  it('finds the whole name, a distinctive part, in any case, in every place', () => {
    expect(findLeaks('Gxzqy', 'Oxzqy', { ...empty, logs: ['read GXZQY'] })).toEqual([
      'log line #0 holds a part of the name',
    ]);
    expect(findLeaks('Gxzqy', 'Oxzqy', { ...empty, responses: ['{"x":"gxz"}'] })).toHaveLength(1);
    expect(findLeaks('Gxzqy', 'Oxzqy', { ...empty, rows: ['{"name":"Gxzqy"}'] })).toHaveLength(1);
  });

  it('does not flag the canonical spelling the account really holds', () => {
    expect(
      findLeaks('Gxzqy', 'Oxzqy', { ...empty, rows: ['{"name":"Oxzqy"}'], logs: ['stored Oxzqy'] }),
    ).toEqual([]);
  });
});
