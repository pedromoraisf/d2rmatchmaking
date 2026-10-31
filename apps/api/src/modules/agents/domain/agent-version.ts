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
    if (this.major !== minimum.major) {
      return this.major < minimum.major;
    }
    if (this.minor !== minimum.minor) {
      return this.minor < minimum.minor;
    }
    return this.patch < minimum.patch;
  }
}
