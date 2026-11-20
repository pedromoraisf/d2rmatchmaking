import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderInLanguage } from '../test/render.tsx';
import { CodeSigningPage } from './CodeSigningPage.tsx';
import { Layout } from './Layout.tsx';
import { CODE_SIGNING_PATH, SIGNING_ROLES, isCodeSigningPath } from './signing-policy.ts';

afterEach(cleanup);

describe('the code signing policy page (AGR-08)', () => {
  it('states the project, the licence and the provider of the certificate, in English', () => {
    renderInLanguage(<CodeSigningPage />, ['en-US']);
    expect(screen.getByRole('heading', { name: 'Code signing policy' })).toBeTruthy();
    expect(screen.getByText(/open-source community project, released under the MIT licence/)).toBeTruthy();
    expect(
      screen.getByText('Free code signing provided by SignPath.io, certificate by SignPath Foundation.'),
    ).toBeTruthy();
  });

  it('lists who commits, who reviews and who approves, each with a handle', () => {
    renderInLanguage(<CodeSigningPage />, ['en-US']);
    const roles = within(screen.getByRole('region', { name: 'Who signs' }));
    expect(roles.getAllByRole('listitem')).toHaveLength(SIGNING_ROLES.length);
    expect(roles.getByText(/Committer/)).toBeTruthy();
    expect(roles.getByText(/Reviewer/)).toBeTruthy();
    expect(roles.getByText(/Approver/)).toBeTruthy();
    for (const link of roles.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\/[A-Za-z0-9-]+$/);
    }
  });

  it('says what the program reads and never does, and carries a privacy statement', () => {
    renderInLanguage(<CodeSigningPage />, ['en-US']);
    expect(screen.getByText(/reads only the pixels of the Diablo II: Resurrected window/)).toBeTruthy();
    expect(screen.getByText(/never reads or writes the game's memory/)).toBeTruthy();
    const privacy = within(screen.getByRole('region', { name: 'Privacy' }));
    expect(privacy.getByText(/will not transfer any information to other networked systems/)).toBeTruthy();
    expect(privacy.getByText(/does not send screenshots or video/)).toBeTruthy();
  });

  it('says the same in Brazilian Portuguese', () => {
    renderInLanguage(<CodeSigningPage />, ['pt-BR']);
    expect(screen.getByRole('heading', { name: 'Política de assinatura de código' })).toBeTruthy();
    expect(screen.getByText(/Assinatura de código gratuita fornecida pela SignPath\.io/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Quem assina' })).getAllByRole('listitem')).toHaveLength(
      3,
    );
    expect(screen.getByText(/lê apenas os pixels da janela do Diablo II: Resurrected/)).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Privacidade' })).getByText(
        /não transferirá nenhuma informação/,
      ),
    ).toBeTruthy();
  });

  it('links the source and the issue tracker, and answers its path with or without a slash', () => {
    renderInLanguage(<CodeSigningPage />, ['en-US']);
    expect(screen.getByRole('link', { name: 'Source code' }).getAttribute('href')).toBe(
      'https://github.com/pedromoraisf/d2rmatchmaking',
    );
    expect(screen.getByRole('link', { name: 'Contact the maintainer' }).getAttribute('href')).toMatch(
      /\/issues$/,
    );
    expect(isCodeSigningPath(CODE_SIGNING_PATH)).toBe(true);
    expect(isCodeSigningPath(`${CODE_SIGNING_PATH}/`)).toBe(true);
    for (const other of ['/', '/code-signing/x', '/code-signing-policy', '']) {
      expect(isCodeSigningPath(other), other).toBe(false);
    }
  });
});

describe('the footer link to the policy (AGR-08)', () => {
  it('links the policy page from every page, in both languages', () => {
    renderInLanguage(<Layout>{null}</Layout>, ['en-US']);
    expect(
      within(screen.getByRole('contentinfo'))
        .getByRole('link', { name: 'Code signing policy' })
        .getAttribute('href'),
    ).toBe(CODE_SIGNING_PATH);
    cleanup();
    renderInLanguage(<Layout>{null}</Layout>, ['pt-BR']);
    expect(
      within(screen.getByRole('contentinfo'))
        .getByRole('link', { name: 'Política de assinatura de código' })
        .getAttribute('href'),
    ).toBe(CODE_SIGNING_PATH);
  });
});
