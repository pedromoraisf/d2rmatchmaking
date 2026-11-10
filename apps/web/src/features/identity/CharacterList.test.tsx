import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterView } from '@d2rmm/contracts';
import { renderInLanguage } from '../../test/render.tsx';
import { CharacterList } from './CharacterList.tsx';

afterEach(cleanup);

const sorc: CharacterView = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  ladder: 'sc-ladder',
  era: 'lod',
  unlockedDifficulties: ['normal', 'nightmare'],
  readAt: '2026-11-10T12:00:00.000Z',
};

const hammer: CharacterView = {
  name: 'Hammer',
  class: 'sorceress',
  level: 85,
  ladder: 'hc-nonladder',
  era: 'classic',
  unlockedDifficulties: ['normal'],
  readAt: '2026-11-10T12:00:00.000Z',
};

describe('CharacterList', () => {
  it('says how to add characters when there are none', () => {
    renderInLanguage(<CharacterList characters={[]} />);
    expect(
      screen.getByText(
        'Open the character selection screen in the game with the agent running to add your characters.',
      ),
    ).toBeTruthy();
  });

  it('lists the name, class, level, mode, ladder, era, unlocked difficulties and the read time', () => {
    renderInLanguage(<CharacterList characters={[sorc]} />);

    expect(screen.getByText('Sorc')).toBeTruthy();
    expect(screen.getByText('Sorceress')).toBeTruthy();
    expect(screen.getByText('Level 85')).toBeTruthy();
    expect(screen.getByText('Softcore')).toBeTruthy();
    expect(screen.getByText('Ladder')).toBeTruthy();
    expect(screen.getByText('Expansion')).toBeTruthy();
    expect(screen.getByText('Unlocked: Normal and Nightmare')).toBeTruthy();
    expect(screen.getByText(/^Last read /)).toBeTruthy();
  });

  it('names a non-ladder hardcore character as such', () => {
    renderInLanguage(<CharacterList characters={[hammer]} />);

    expect(screen.getByText('Hardcore')).toBeTruthy();
    expect(screen.getByText('Non-ladder')).toBeTruthy();
    expect(screen.getByText('Classic')).toBeTruthy();
  });

  it('shows the Portuguese words in the pt-BR site', () => {
    renderInLanguage(<CharacterList characters={[sorc]} />, ['pt-BR']);

    expect(screen.getByText('Seus personagens')).toBeTruthy();
    expect(screen.getByText('Feiticeira')).toBeTruthy();
    expect(screen.getByText('Nível 85')).toBeTruthy();
    expect(screen.getByText('Desbloqueadas: Normal e Pesadelo')).toBeTruthy();
  });

  it('is reached with the keyboard as one labelled region', async () => {
    renderInLanguage(<CharacterList characters={[sorc]} />);

    await userEvent.tab();

    const region = screen.getByRole('region', { name: 'Your characters' });
    expect(document.activeElement).toBe(region);
  });
});
