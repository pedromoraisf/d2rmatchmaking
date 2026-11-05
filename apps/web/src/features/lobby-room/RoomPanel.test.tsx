import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderInLanguage } from '../../test/render.tsx';
import { type RoomShown, RoomPanel } from './RoomPanel.tsx';

afterEach(cleanup);

const awaitingHost: RoomShown = { roomId: '4821', gameName: 'mmbaalh-12', stage: 'awaiting_host' };
const created: RoomShown = { roomId: '4821', gameName: 'mmbaalh-12', stage: 'created' };

describe('RoomPanel', () => {
  it('shows the game name, "No password" and the stage of the room', () => {
    renderInLanguage(<RoomPanel room={awaitingHost} />);
    expect(screen.getByText('mmbaalh-12')).toBeTruthy();
    expect(screen.getByText('No password')).toBeTruthy();
    expect(screen.getByText('Awaiting host')).toBeTruthy();
  });

  it('shows the stage as Created once the room is created', () => {
    renderInLanguage(<RoomPanel room={created} />);
    expect(screen.getByText('Created')).toBeTruthy();
  });
});
