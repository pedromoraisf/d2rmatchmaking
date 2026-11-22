import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createAgentI18n, translatorFor } from '../shared/i18n.ts';
import type { AgentView } from '../shared/labels.ts';
import { App } from './App.tsx';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));

const en = translatorFor(createAgentI18n('en'));

const view = (overrides: Partial<AgentView> = {}): AgentView => ({
  pairing: 'paired',
  connectivity: 'connected',
  room: null,
  update: 'idle',
  readyCheckOpen: false,
  hotkeys: { accept: 'Ctrl+Shift+A', fill: 'Ctrl+Shift+F' },
  diagnostics: null,
  ...overrides,
});

// The handler the window registered for `agent-state`: the test plays the core's publishing.
const publish = (state: AgentView) => {
  const handler = vi.mocked(listen).mock.calls[0]?.[1] as unknown as (event: { payload: AgentView }) => void;
  act(() => {
    handler({ payload: state });
  });
};

beforeEach(() => {
  vi.mocked(listen).mockClear();
  vi.mocked(invoke).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('listens to agent-state and renders the state the core publishes', () => {
    render(<App translate={en} />);
    expect(vi.mocked(listen).mock.calls[0]?.[0]).toBe('agent-state');

    publish(view({ pairing: { showingCode: { code: '123456', minutesLeft: 4 } } }));

    expect(screen.getByText('123456')).toBeTruthy();
    expect(screen.getByText('Expires in 4 min')).toBeTruthy();
  });

  it('sends a changed hotkey through the set_hotkey command (AST-01)', () => {
    render(<App translate={en} />);
    publish(view());

    fireEvent.change(screen.getByLabelText('Accept a ready check'), { target: { value: 'Alt+Q' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);

    expect(invoke).toHaveBeenCalledWith('set_hotkey', { action: 'accept', combination: 'Alt+Q' });
  });

  it('paused view requests a new code through the get_new_code command', () => {
    render(<App translate={en} />);
    publish(view({ pairing: 'paused' }));

    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));

    expect(invoke).toHaveBeenCalledWith('get_new_code');
  });

  it('shows the consent the store holds, and asks the store to change it on a press', async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) =>
      command === 'get_consent' ? true : undefined,
    );
    render(<App translate={en} />);

    expect(await screen.findByRole('button', { name: 'Withdraw consent' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }));

    expect(invoke).toHaveBeenCalledWith('set_consent', { consent: false });
    expect(await screen.findByRole('button', { name: 'Allow capture' })).toBeTruthy();
    vi.mocked(invoke).mockImplementation(async () => undefined);
  });

  it('shows no consent when the store does not answer true', async () => {
    vi.mocked(invoke).mockImplementation(async () => undefined);
    render(<App translate={en} />);

    expect(await screen.findByRole('button', { name: 'Allow capture' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Withdraw consent' })).toBeNull();
  });

  it('shows the diagnostics the store holds and asks the store to change them on a press', async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) =>
      command === 'get_diagnostics'
        ? { enabled: true, tier: 'production' }
        : command === 'set_diagnostics'
          ? false
          : undefined,
    );
    render(<App translate={en} />);

    const control = (await screen.findByRole('switch', { name: 'Send diagnostics' })) as HTMLInputElement;
    expect(control.checked).toBe(true);
    fireEvent.click(control);

    expect(invoke).toHaveBeenCalledWith('set_diagnostics', { enabled: false });
    expect(await screen.findByText('Diagnostics are off. The agent sends none.')).toBeTruthy();
    vi.mocked(invoke).mockImplementation(async () => undefined);
  });

  it('shows no diagnostics section when the store does not answer', async () => {
    vi.mocked(invoke).mockImplementation(async () => undefined);
    render(<App translate={en} />);

    expect(await screen.findByRole('button', { name: 'Allow capture' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Send diagnostics' })).toBeNull();
  });
});
