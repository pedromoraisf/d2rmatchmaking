import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderInLanguage } from '../test/render.tsx';
import { AGENT_DOWNLOAD_URL, Layout } from './Layout.tsx';

afterEach(cleanup);

describe('Layout', () => {
  it('links the download button to the latest agent release', () => {
    renderInLanguage(<Layout>{null}</Layout>);
    const releaseUrl =
      'https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/D2RMatchMaking-setup.exe';
    expect(screen.getByRole('link', { name: 'Download the agent' }).getAttribute('href')).toBe(releaseUrl);
    expect(AGENT_DOWNLOAD_URL).toBe(releaseUrl);
  });

  it('shows the non-affiliation notice in English', () => {
    renderInLanguage(<Layout>{null}</Layout>, ['en-US']);
    expect(
      screen.getByText(
        'D2R Match Making is a community project and is not affiliated with Blizzard Entertainment.',
      ),
    ).toBeTruthy();
  });

  it('shows the SmartScreen note next to the download link in English', () => {
    renderInLanguage(<Layout>{null}</Layout>, ['en-US']);
    const link = screen.getByRole('link', { name: 'Download the agent' });
    const note = screen.getByText(
      'The installer is not code-signed yet, so Windows SmartScreen may warn you before it runs.',
    );
    expect(link.parentElement?.contains(note)).toBe(true);
  });

  it('shows the SmartScreen note next to the download link in pt-BR', () => {
    renderInLanguage(<Layout>{null}</Layout>, ['pt-BR']);
    const link = screen.getByRole('link', { name: 'Baixar o agente' });
    const note = screen.getByText(
      'O instalador ainda não tem assinatura de código, por isso o Windows SmartScreen pode avisar antes de executá-lo.',
    );
    expect(link.parentElement?.contains(note)).toBe(true);
  });

  it('shows the notice and the download button in pt-BR', () => {
    renderInLanguage(<Layout>{null}</Layout>, ['pt-BR']);
    expect(
      screen.getByText(
        'D2R Match Making é um projeto da comunidade e não é afiliado à Blizzard Entertainment.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Baixar o agente' })).toBeTruthy();
  });
});
