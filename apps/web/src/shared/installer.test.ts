import { describe, expect, it } from 'vitest';
import { installerIsSigned } from './installer.ts';

describe('installerIsSigned (AGR-09)', () => {
  it('is signed only when the setting is exactly "true"', () => {
    expect(installerIsSigned({ VITE_INSTALLER_SIGNED: 'true' })).toBe(true);
  });

  it('reads unset, empty and any other text as unsigned', () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) {
      expect(
        installerIsSigned(value === undefined ? {} : { VITE_INSTALLER_SIGNED: value }),
        String(value),
      ).toBe(false);
    }
  });

  it('is unsigned in the build the tests run in', () => {
    expect(installerIsSigned()).toBe(false);
  });
});
