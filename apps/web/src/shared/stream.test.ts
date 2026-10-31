import { describe, expect, it } from 'vitest';
import { openSiteStream } from './stream.ts';
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

  it('closes the connection when the closer runs', () => {
    const fake = fakeSource();
    const close = openSiteStream(handlers().handlers, fake.connect);
    close();
    expect(fake.closed()).toBe(1);
  });
});
