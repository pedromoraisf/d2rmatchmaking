import { createHash } from 'node:crypto';
import type { SecretDomain, SecretHasher } from '../ports.ts';

/** SHA-256 of `domain + ':' + value`, so a value stored for one domain never matches another (design.md § Identity). */
export class FakeSecretHasher implements SecretHasher {
  hash(domain: SecretDomain, value: string): string {
    return createHash('sha256').update(`${domain}:${value}`).digest('hex');
  }
}
