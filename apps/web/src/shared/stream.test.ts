import { describe, expect, it } from 'vitest';
import { SiteStreamEvent } from '@d2rmm/contracts';
import { openSiteStream, type StreamSource } from './stream.ts';
import { fakeSource } from '../test/fake-api.ts';

const assigned = {
  roomId: '4821',
  run: 1,
  expectedGameName: 'mmbaalh-12',
  members: [{ accountId: 'acc-1', characterId: null, joinOrder: 1, role: 'host' }],
};

function handlers() {
  const opened: number[] = [];
  const events: unknown[] = [];
  return {
    opened,
    events,
    handlers: {
      onOpen: () => opened.push(opened.length + 1),
      onEvent: (event: unknown) => events.push(event),
    },
  };
}

describe('site stream', () => {
  it('connects to the same-origin stream route', () => {
    const fake = fakeSource();
    openSiteStream(handlers().handlers, fake.connect);
    expect(fake.urls).toStrictEqual(['/api/v1/stream']);
  });

  it('reports every open so the caller re-reads the state it may have missed', () => {
    const fake = fakeSource();
    const { handlers: h, opened } = handlers();
    openSiteStream(h, fake.connect);
    fake.emit('open');
    fake.emit('open');
    expect(opened).toStrictEqual([1, 2]);
  });

  it('delivers an event parsed by the contract under its SSE name', () => {
    const fake = fakeSource();
    const { handlers: h, events } = handlers();
    openSiteStream(h, fake.connect);
    fake.emit('room.assigned', JSON.stringify(assigned));
    expect(events).toStrictEqual([{ type: 'room.assigned', data: assigned }]);
  });

  it('drops an event that breaks the contract', () => {
    const fake = fakeSource();
    const { handlers: h, events } = handlers();
    openSiteStream(h, fake.connect);
    fake.emit('room.assigned', JSON.stringify({ ...assigned, expectedGameName: undefined }));
    fake.emit('room.assigned', 'not json');
    expect(events).toStrictEqual([]);
  });

  it('listens to every event type of the contract site stream', () => {
    const listened: string[] = [];
    const source: StreamSource = {
      addEventListener(type) {
        listened.push(type);
      },
      close() {},
    };
    openSiteStream(handlers().handlers, () => source);
    const contract = SiteStreamEvent.options.map((option) => option.shape.type.value);
    expect(contract).toContain('characters.updated');
    expect(listened).toStrictEqual(expect.arrayContaining(contract));
  });

  it('delivers characters.updated to onEvent (CHR-12)', () => {
    const fake = fakeSource();
    const { handlers: h, events } = handlers();
    openSiteStream(h, fake.connect);
    fake.emit('characters.updated', '{}');
    expect(events).toStrictEqual([{ type: 'characters.updated', data: {} }]);
  });

  it('closes the connection when the closer runs', () => {
    const fake = fakeSource();
    const close = openSiteStream(handlers().handlers, fake.connect);
    close();
    expect(fake.closed()).toBe(1);
  });
});
