// The production providers of the shared-kernel ports (design.md § Shared kernel additions): the wall clock, node:crypto
// randomness and random UUIDs. Only the composition roots use them; domain and application code see the ports.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Clock, IdGenerator, RandomSource } from '../shared-kernel/index.ts';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class NodeRandomSource implements RandomSource {
  int(maxExclusive: number): number {
    return randomInt(maxExclusive);
  }

  bytes(n: number): Uint8Array {
    return randomBytes(n);
  }
}

export class RandomUuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
