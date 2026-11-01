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

  it('paused view requests a new code through the get_new_code command', () => {
    render(<App translate={en} />);
    publish(view({ pairing: 'paused' }));

    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));

    expect(invoke).toHaveBeenCalledWith('get_new_code');
  });
});
