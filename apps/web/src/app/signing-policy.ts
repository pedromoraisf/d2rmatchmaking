// The code signing policy page (agent-release AGR-08): where it lives and who holds each role. SignPath Foundation asks every
// project to publish who commits, who reviews and who approves a signing request; the page and the README read this one list.
// Roles are the maintainer's public GitHub handle until the maintainer says otherwise; the contact email waits for T9.

export const CODE_SIGNING_PATH = '/code-signing';

/** The page answers its path with or without a trailing slash. */
export function isCodeSigningPath(pathname: string): boolean {
  return pathname === CODE_SIGNING_PATH || pathname === `${CODE_SIGNING_PATH}/`;
}

export type SigningRole = 'committers' | 'reviewers' | 'approvers';

export interface SigningRoleHolder {
  readonly role: SigningRole;
  /** A public GitHub handle. */
  readonly handle: string;
}

export const SIGNING_ROLES: readonly SigningRoleHolder[] = [
  { role: 'committers', handle: 'pedromoraisf' },
  { role: 'reviewers', handle: 'pedromoraisf' },
  { role: 'approvers', handle: 'pedromoraisf' },
];

export const REPOSITORY_URL = 'https://github.com/pedromoraisf/d2rmatchmaking';
