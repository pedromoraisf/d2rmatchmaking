import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createAgentI18n, translatorFor } from '../shared/i18n.ts';
import type { AgentView, Diagnostics, PairingState } from '../shared/labels.ts';
import { DiagnosticsView } from './DiagnosticsView.tsx';
import { PairingView } from './PairingView.tsx';
import { StatusView } from './StatusView.tsx';

const en = translatorFor(createAgentI18n('en'));
const ptBR = translatorFor(createAgentI18n('pt-BR'));

const view = (overrides: Partial<AgentView> = {}): AgentView => ({
  pairing: 'paired',
  connectivity: 'connected',
  room: null,
  update: 'idle',
  readyCheckOpen: false,
  diagnostics: null,
  ...overrides,
});

// The views are rendered through these helpers so the state names stay out of JSX (i18next/no-literal-string).
const renderPairing = (pairing: PairingState, onNewCode = vi.fn(), translate = en) =>
  render(<PairingView pairing={pairing} translate={translate} onNewCode={onNewCode} />);

const renderStatus = (overrides: Partial<AgentView> = {}) =>
  render(<StatusView view={view(overrides)} translate={en} />);

afterEach(() => {
  cleanup();
});

describe('pairing view', () => {
  it('pairing view shows the code and the minutes left', () => {
    renderPairing({ showingCode: { code: '123456', minutesLeft: 3 } });

    expect(screen.getByText('123456')).toBeTruthy();
    expect(screen.getByText('Pairing code')).toBeTruthy();
    expect(screen.getByText('Type this code on the site')).toBeTruthy();
    expect(screen.getByText('Expires in 3 min')).toBeTruthy();
  });

  it('paused view offers a new code and calls back once per press', () => {
    const onNewCode = vi.fn();
    renderPairing('paused', onNewCode);

    expect(screen.getByText('Pairing paused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));

    expect(onNewCode).toHaveBeenCalledTimes(1);
  });

  it('rate limited view shows the wait and offers no new code', () => {
    renderPairing('rateLimited');

    expect(screen.getByText('Too many codes requested. Try again later.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('paired view shows Paired', () => {
    renderPairing('paired');

    expect(screen.getByText('Paired')).toBeTruthy();
  });

  it('unreachable pairing shows the server message', () => {
    renderPairing('unreachable');

    expect(screen.getByText("Can't reach the server")).toBeTruthy();
  });

  it('save failure shows the retry message', () => {
    renderPairing('saveFailed');

    expect(screen.getByText('Could not save the pairing. Try again.')).toBeTruthy();
  });

  it('pairing view in pt-BR', () => {
    renderPairing({ showingCode: { code: '654321', minutesLeft: 1 } }, vi.fn(), ptBR);

    expect(screen.getByText('Código de pareamento')).toBeTruthy();
    expect(screen.getByText('Expira em 1 min')).toBeTruthy();
  });
});

describe('status view', () => {
  it('shows Connected once paired and the server message when a heartbeat fails', () => {
    const { unmount } = renderStatus();
    expect(screen.getByText('Connected')).toBeTruthy();
    unmount();

    renderStatus({ connectivity: 'unreachable' });
    expect(screen.getByText("Can't reach the server")).toBeTruthy();
  });

  it('shows the room line with the game name', () => {
    renderStatus({ room: { gameName: 'mmbaalh-12', needsReveal: false, matched: false } });

    expect(screen.getByText('Room mmbaalh-12 — waiting for the game')).toBeTruthy();
  });

  it('tells the player to reveal the game name while it is masked (AGN-04)', () => {
    const { unmount } = renderStatus({
      room: { gameName: 'mmbaalh-12', needsReveal: true, matched: false },
    });
    expect(
      screen.getByText('Open the Party panel (P) and click the eye to show the game name.'),
    ).toBeTruthy();
    unmount();

    renderStatus({ room: { gameName: 'mmbaalh-12', needsReveal: true, matched: true } });
    expect(
      screen.queryByText('Open the Party panel (P) and click the eye to show the game name.'),
    ).toBeNull();
  });

  it('shows the reveal hint in pt-BR', () => {
    const masked = view({ room: { gameName: 'mmbaalh-12', needsReveal: true, matched: false } });
    render(<StatusView view={masked} translate={ptBR} />);

    expect(
      screen.getByText('Abra o painel Party (P) e clique no olho para mostrar o nome do jogo.'),
    ).toBeTruthy();
  });

  it('shows the update failure and the update requirement', () => {
    const { unmount } = renderStatus({ update: 'failed' });
    expect(screen.getByText('Update failed — will retry')).toBeTruthy();
    unmount();

    renderStatus({ update: 'required' });
    expect(screen.getByText('Update required')).toBeTruthy();
  });

  it('shows no connection line before pairing and nothing for an idle update', () => {
    const { container } = renderStatus({ pairing: 'requesting' });

    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('shows the hotkey line while a ready check is open, in English and Portuguese (RDY-07)', () => {
    const { unmount } = renderStatus({ readyCheckOpen: true });
    expect(screen.getByText('A ready check is open: press Ctrl+Shift+A to accept it.')).toBeTruthy();
    unmount();

    render(<StatusView view={view({ readyCheckOpen: true })} translate={ptBR} />);
    expect(
      screen.getByText('Há uma confirmação de partida: pressione Ctrl+Shift+A para aceitar.'),
    ).toBeTruthy();
  });

  it('shows no hotkey line once the check is over', () => {
    renderStatus({ readyCheckOpen: false });
    expect(screen.queryByText('A ready check is open: press Ctrl+Shift+A to accept it.')).toBeNull();
  });
});

describe('diagnostics view', () => {
  const diagnostics: Diagnostics = {
    screen: 'characterSelect',
    frameWidth: 1920,
    frameHeight: 1080,
    cardsRead: 2,
    cardsSettled: 1,
    popupOptionsFound: 2,
    rejected: [{ slot: 1, reason: 'name-disagree' }],
    post: 'not-sent',
  };

  it('shows nothing before the first look', () => {
    const { container } = render(<DiagnosticsView diagnostics={null} translate={en} />);

    expect(container.innerHTML).toBe('');
  });

  it('shows the screen, the frame size, the counts, each reason code and the last send', () => {
    render(<DiagnosticsView diagnostics={diagnostics} translate={en} />);

    expect(screen.getByText('Diagnostics')).toBeTruthy();
    expect(screen.getByText('Screen: Character selection')).toBeTruthy();
    expect(screen.getByText('Frame: 1920×1080')).toBeTruthy();
    expect(screen.getByText('Cards read: 2, settled: 1')).toBeTruthy();
    expect(screen.getByText('Popup options found: 2')).toBeTruthy();
    expect(screen.getByText('Card 2 not settled: name-disagree')).toBeTruthy();
    expect(screen.getByText('Last send: not-sent')).toBeTruthy();
  });

  it('is translated to pt-BR', () => {
    render(<DiagnosticsView diagnostics={diagnostics} translate={ptBR} />);

    expect(screen.getByText('Diagnóstico')).toBeTruthy();
    expect(screen.getByText('Tela: Seleção de personagem')).toBeTruthy();
    expect(screen.getByText('Último envio: not-sent')).toBeTruthy();
  });
});
