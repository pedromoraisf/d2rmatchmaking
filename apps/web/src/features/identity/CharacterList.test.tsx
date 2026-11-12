import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterView } from '@d2rmm/contracts';
import { renderInLanguage } from '../../test/render.tsx';
import { createApiClient, type Fetcher } from '../../shared/api-client.ts';
import { CharacterList } from './CharacterList.tsx';

afterEach(cleanup);

const sorc: CharacterView = {
  id: 'character-sorc',
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  hardcore: false,
  ladder: 'ladder',
  era: 'lod',
  unlockedDifficulties: ['normal', 'nightmare'],
  readAt: '2026-11-10T12:00:00.000Z',
};

const hammer: CharacterView = {
  id: 'character-hammer',
  name: 'Hammer',
  class: 'sorceress',
  level: 85,
  hardcore: true,
  ladder: 'non-ladder',
  era: 'classic',
  unlockedDifficulties: ['normal'],
  readAt: '2026-11-10T12:00:00.000Z',
};

const zon: CharacterView = {
  id: 'character-zon',
  name: 'Zon',
  class: 'amazon',
  level: 60,
  hardcore: false,
  ladder: null,
  era: null,
  unlockedDifficulties: ['normal'],
  readAt: '2026-11-10T12:00:00.000Z',
};

const PROMPT = 'Declare ladder and era to queue with this character';

/** A client whose declarations answer `status`, and every request it sent. */
function clientAnswering(status: number) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetcher: Fetcher = (url, init) => {
    sent.push({ url, init });
    return Promise.resolve(new Response(null, { status }));
  };
  return { client: createApiClient(fetcher), sent };
}

describe('CharacterList', () => {
  it('says how to add characters when there are none', () => {
    const { client } = clientAnswering(204);
    renderInLanguage(<CharacterList characters={[]} client={client} onDeclared={() => {}} />);
    expect(
      screen.getByText(
        'Open the character selection screen in the game with the agent running to add your characters.',
      ),
    ).toBeTruthy();
  });

  it('lists the name, class, level, mode, ladder, era, unlocked difficulties and the read time', () => {
    const { client } = clientAnswering(204);
    renderInLanguage(<CharacterList characters={[sorc]} client={client} onDeclared={() => {}} />);

    expect(screen.getByText('Sorc')).toBeTruthy();
    expect(screen.getByText('Sorceress')).toBeTruthy();
    expect(screen.getByText('Level 85')).toBeTruthy();
    expect(screen.getByText('Softcore')).toBeTruthy();
    expect(screen.getByText('Ladder')).toBeTruthy();
    expect(screen.getByText('Expansion')).toBeTruthy();
    expect(screen.getByText('Unlocked: Normal and Nightmare')).toBeTruthy();
    expect(screen.getByText(/^Last read /)).toBeTruthy();
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('shows each unlocked difficulty as a tag in its colour (SHL-04)', () => {
    const { client } = clientAnswering(204);
    const { container } = renderInLanguage(
      <CharacterList characters={[sorc]} client={client} onDeclared={() => {}} />,
    );

    expect(container.querySelector('.tag.d-n')?.textContent).toBe('Normal');
    expect(container.querySelector('.tag.d-nm')?.textContent).toBe('Nightmare');
    expect(container.querySelector('.tag.d-h')).toBeNull();
  });

  it('names a non-ladder hardcore character as such', () => {
    const { client } = clientAnswering(204);
    renderInLanguage(<CharacterList characters={[hammer]} client={client} onDeclared={() => {}} />);

    expect(screen.getByText('Hardcore')).toBeTruthy();
    expect(screen.getByText('Non-ladder')).toBeTruthy();
    expect(screen.getByText('Classic')).toBeTruthy();
  });

  it('asks the player to declare ladder and era on a character that has none declared (CHR-15)', () => {
    const { client } = clientAnswering(204);
    renderInLanguage(<CharacterList characters={[zon]} client={client} onDeclared={() => {}} />);

    const card = screen.getByText('Zon').closest('li');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText(PROMPT)).toBeTruthy();
    expect(within(card as HTMLElement).getByRole('button', { name: 'Save ladder and era' })).toBeTruthy();
  });

  it('keeps the save off until both the ladder and the era are chosen (CHR-15)', async () => {
    const { client, sent } = clientAnswering(204);
    renderInLanguage(<CharacterList characters={[zon]} client={client} onDeclared={() => {}} />);
    const save = screen.getByRole('button', { name: 'Save ladder and era' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await userEvent.click(screen.getByRole('radio', { name: 'Non-ladder' }));
    expect(save.disabled).toBe(true);

    await userEvent.click(screen.getByRole('radio', { name: 'Reign of the Warlock' }));
    expect(save.disabled).toBe(false);
    expect(sent).toEqual([]);
  });

  it('saves the declaration with the keyboard and reads the list again (CHR-15)', async () => {
    const { client, sent } = clientAnswering(204);
    const onDeclared = vi.fn();
    renderInLanguage(<CharacterList characters={[zon]} client={client} onDeclared={onDeclared} />);

    const nonLadder = screen.getByRole('radio', { name: 'Non-ladder' });
    nonLadder.focus();
    await userEvent.keyboard(' ');
    const reignOfTheWarlock = screen.getByRole('radio', { name: 'Reign of the Warlock' });
    reignOfTheWarlock.focus();
    await userEvent.keyboard(' ');
    screen.getByRole('button', { name: 'Save ladder and era' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('/api/v1/me/characters/character-zon');
    expect(sent[0]?.init.method).toBe('PATCH');
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ ladder: 'non-ladder', era: 'rotw' });
    expect(onDeclared).toHaveBeenCalledTimes(1);
  });

  it('says the declaration was not saved when the API refuses it', async () => {
    const { client } = clientAnswering(404);
    const onDeclared = vi.fn();
    renderInLanguage(<CharacterList characters={[zon]} client={client} onDeclared={onDeclared} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Ladder' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Classic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save ladder and era' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('The ladder and era were not saved. Try again.')).toBeTruthy();
    expect(onDeclared).not.toHaveBeenCalled();
  });

  it('shows the Portuguese words in the pt-BR site', () => {
    const { client } = clientAnswering(204);
    renderInLanguage(<CharacterList characters={[sorc]} client={client} onDeclared={() => {}} />, ['pt-BR']);

    expect(screen.getByText('Seus personagens')).toBeTruthy();
    expect(screen.getByText('Feiticeira')).toBeTruthy();
    expect(screen.getByText('Nível 85')).toBeTruthy();
    expect(screen.getByText('Desbloqueadas: Normal e Pesadelo')).toBeTruthy();
  });

  it('shows the declaration in Portuguese on the pt-BR site', () => {
    const { client } = clientAnswering(204);
    renderInLanguage(<CharacterList characters={[zon]} client={client} onDeclared={() => {}} />, ['pt-BR']);

    expect(screen.getByText('Declare ladder e era para entrar na fila com este personagem')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar ladder e era' })).toBeTruthy();
  });

  it('is reached with the keyboard as one labelled region', async () => {
    const { client } = clientAnswering(204);
    renderInLanguage(<CharacterList characters={[sorc]} client={client} onDeclared={() => {}} />);

    await userEvent.tab();

    const region = screen.getByRole('region', { name: 'Your characters' });
    expect(document.activeElement).toBe(region);
  });
});
