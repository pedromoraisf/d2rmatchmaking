import { createHash } from 'node:crypto';
import type { SecretDomain, SecretHasher } from '../../application/ports.ts';

/**
 * SHA-256 of `domain + ':' + value` (design.md § Identity). The domain prefix keeps a value hashed for one table from
 * matching a row of another: a session token never matches an agent token hash.
 */
export class Sha256SecretHasher implements SecretHasher {
  hash(domain: SecretDomain, value: string): string {
    return createHash('sha256').update(`${domain}:${value}`).digest('hex');
  }
}
