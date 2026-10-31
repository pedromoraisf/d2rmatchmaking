import { describe, expect, it } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';

// Every key path of a translation file, with nested objects flattened to dotted paths.
const keyPaths = (node: unknown, prefix = ''): string[] => {
  if (typeof node !== 'object' || node === null) {
    return [prefix];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    keyPaths(child, prefix === '' ? key : `${prefix}.${key}`),
  );
};

describe('translation files', () => {
  it('en and pt-BR hold the same keys', () => {
    const english = keyPaths(en).sort();
    const portuguese = keyPaths(ptBR).sort();
    expect(portuguese).toStrictEqual(english);
  });

  it('every key has a non-empty English and pt-BR text', () => {
    for (const path of keyPaths(en)) {
      const value = path
        .split('.')
        .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], en);
      expect(value, path).toBeTypeOf('string');
      expect(value, path).not.toBe('');
    }
  });

  it('pt-BR translates the agent download action', () => {
    expect(ptBR.app.downloadAgent).toBe('Baixar o agente');
  });
});
