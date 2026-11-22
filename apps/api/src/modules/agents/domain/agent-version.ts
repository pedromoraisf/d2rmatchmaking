import { err, ok, type Result } from '../../../shared-kernel/result.ts';

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** A strict `major.minor.patch` agent version, compared numerically (AWS-12). */
export class AgentVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;

  private constructor(major: number, minor: number, patch: number) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
  }

  static parse(raw: string): Result<AgentVersion, 'invalid-version'> {
    const match = SEMVER_PATTERN.exec(raw);
    if (match === null) {
      return err('invalid-version');
    }
    return ok(new AgentVersion(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  isBelow(minimum: AgentVersion): boolean {
    // The first component that differs decides; all equal is not below.
    const difference = this.major - minimum.major || this.minor - minimum.minor || this.patch - minimum.patch;
    return difference < 0;
  }
}
