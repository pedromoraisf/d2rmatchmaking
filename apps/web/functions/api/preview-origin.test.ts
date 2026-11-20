// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { previewApiOriginOf } from './preview-origin.ts';

const PR = 'https://d2rmm-api-pr-12.onrender.com';

describe('previewApiOriginOf', () => {
  it('uses the committed configuration, which names no preview API', () => {
    expect(previewApiOriginOf(undefined)).toBeUndefined();
  });

  it('uses the origin a deploy wrote into the configuration', () => {
    expect(previewApiOriginOf(undefined, PR)).toBe(PR);
  });

  it('lets the baked origin win over the configuration', () => {
    expect(previewApiOriginOf('https://d2rmm-api-pr-3.onrender.com', PR)).toBe(
      'https://d2rmm-api-pr-3.onrender.com',
    );
  });

  it('ignores anything that is not exactly a Render preview origin', () => {
    expect(previewApiOriginOf(undefined, 'https://evil.example.com')).toBeUndefined();
    expect(previewApiOriginOf(undefined, `${PR}/x`)).toBeUndefined();
    expect(previewApiOriginOf(undefined, 42)).toBeUndefined();
    expect(previewApiOriginOf(undefined, null)).toBeUndefined();
  });
});
