import { describe, expect, it } from 'vitest';
import { previewRefusal } from './preview-guard.ts';

describe('previewRefusal', () => {
  it('lets a service that is not a preview start', () => {
    expect(previewRefusal({})).toBeUndefined();
  });

  it('lets IS_PULL_REQUEST=false start', () => {
    expect(previewRefusal({ IS_PULL_REQUEST: 'false' })).toBeUndefined();
  });

  it('lets a preview with its database ready start', () => {
    expect(previewRefusal({ IS_PULL_REQUEST: 'true', D2RMM_PREVIEW_DATABASE: 'ready' })).toBeUndefined();
  });

  it('refuses a preview without the marker', () => {
    expect(previewRefusal({ IS_PULL_REQUEST: 'true' })).toContain('D2RMM_PREVIEW_DATABASE=ready');
  });

  it('refuses a preview whose marker is anything but ready', () => {
    expect(previewRefusal({ IS_PULL_REQUEST: 'true', D2RMM_PREVIEW_DATABASE: 'true' })).toBeDefined();
  });
});
