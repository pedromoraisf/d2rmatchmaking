import { describe, expect, it } from 'vitest';
import { siteLanguage } from './language.ts';

describe('siteLanguage', () => {
  it.each([['pt-BR'], ['pt-PT'], ['pt']])('answers pt-BR for the preferred language %s', (language) => {
    expect(siteLanguage([language])).toBe('pt-BR');
  });

  it.each([['fr-FR'], ['en-US'], ['es']])('answers English for the preferred language %s', (language) => {
    expect(siteLanguage([language])).toBe('en');
  });

  it('answers English when the browser gives no preferred language', () => {
    expect(siteLanguage([])).toBe('en');
    expect(siteLanguage(undefined)).toBe('en');
  });

  it('decides by the first preferred language only', () => {
    expect(siteLanguage(['fr-FR', 'pt-BR'])).toBe('en');
    expect(siteLanguage(['pt-BR', 'en-US'])).toBe('pt-BR');
  });
});
