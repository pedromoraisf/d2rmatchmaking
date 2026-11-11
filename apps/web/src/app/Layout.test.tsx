import { cleanup, screen, within } from '@testing-library/react';
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

  it('keeps one h1 and the header, navigation, main and footer landmarks (SHL-05)', () => {
    renderInLanguage(<Layout>{null}</Layout>, ['en-US']);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('marks the Play section as the current page', () => {
    renderInLanguage(<Layout>{null}</Layout>, ['pt-BR']);
    expect(screen.getByRole('link', { name: 'Partida' }).getAttribute('aria-current')).toBe('page');
  });

  it('puts the agent panel and the agent download in the status column', () => {
    const panel = 'Agent online';
    renderInLanguage(<Layout status={<p>{panel}</p>}>{null}</Layout>, ['en-US']);
    const status = screen.getByRole('complementary', { name: 'Status' });
    expect(within(status).getByText(panel)).toBeTruthy();
    expect(within(status).getByRole('link', { name: 'Download the agent' })).toBeTruthy();
  });

  it('shows the agent state and the account in the header, before the main column', () => {
    const agentState = 'No agent paired';
    const accountSlot = 'Account slot';
    const content = 'Player content';
    renderInLanguage(
      <Layout agent={<span>{agentState}</span>} account={<span>{accountSlot}</span>}>
        <p>{content}</p>
      </Layout>,
      ['en-US'],
    );
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText(agentState)).toBeTruthy();
    expect(within(banner).getByText(accountSlot)).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText(content)).toBeTruthy();
  });
});
