import { describe, expect, it } from 'vitest';
import { agentLanguage } from './language.ts';

describe('agentLanguage', () => {
  it('follows the Windows display language', () => {
    expect(agentLanguage('pt-BR')).toBe('pt-BR');
    expect(agentLanguage('pt')).toBe('pt-BR');
    expect(agentLanguage('fr-FR')).toBe('en');
    expect(agentLanguage('en-US')).toBe('en');
  });
});
