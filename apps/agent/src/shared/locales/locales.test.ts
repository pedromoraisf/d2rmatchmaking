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

describe('agent translation files', () => {
  it('agent en and pt-BR hold the same keys', () => {
    expect(keyPaths(ptBR).sort()).toStrictEqual(keyPaths(en).sort());
  });
});
