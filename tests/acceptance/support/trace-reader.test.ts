import { describe, expect, it } from 'vitest';
import {
  assertTraceA,
  assertTraceB,
  describeError,
  leaksIn,
  NAMES,
  printTraceIds,
  spansOfTempo,
  type ExportedRecord,
  type SpanRecord,
  type Trace,
} from './trace-reader.ts';

const TRACE = 'a'.repeat(32);
const PLAYER = 'PlayerOne';

function span(
  spanId: string,
  parentSpanId: string,
  name: string,
  attributes: Record<string, unknown> = {},
): SpanRecord {
  return { kind: 'span', traceId: TRACE, spanId, parentSpanId, name, attributes };
}

/** Trace A as the scenario expects it: site action, site request, API request, query, relay and stream delivery. */
const traceA = (): Trace => ({
  traceId: TRACE,
  spans: [
    span('0000000000000001', '', NAMES.siteAction),
    span('0000000000000002', '0000000000000001', `${NAMES.siteRequestPrefix}/api/v1/test-match`),
    span('0000000000000003', '0000000000000002', NAMES.apiRequest),
    span('0000000000000004', '0000000000000003', 'SELECT', {
      'db.system.name': 'postgresql',
      'db.query.text': 'select $1',
    }),
    span('0000000000000005', '0000000000000003', NAMES.relay),
    span('0000000000000006', '0000000000000005', NAMES.deliver),
  ],
});

/** Trace B as the scenario expects it: the agent's observation, its API request, relay and stream delivery. */
const traceB = (): Trace => ({
  traceId: TRACE,
  spans: [
    span('0000000000000011', '', NAMES.agentObservation),
    span('0000000000000015', '0000000000000011', NAMES.agentHttpObservation),
    span('0000000000000012', '0000000000000015', NAMES.apiRequest),
    span('0000000000000013', '0000000000000012', NAMES.relay),
    span('0000000000000014', '0000000000000013', NAMES.deliver),
  ],
});

describe('trace reader', () => {
  it('names the cause of a failed request, so a fetch failure says why it failed', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), { code: 'ECONNREFUSED' });
    expect(describeError(new TypeError('fetch failed', { cause }))).toBe(
      'fetch failed (connect ECONNREFUSED 127.0.0.1:3000, ECONNREFUSED)',
    );
    expect(describeError(new Error('plain'))).toBe('plain');
    expect(describeError('text')).toBe('text');
  });

  it('prints both trace ids', () => {
    const lines: string[] = [];
    printTraceIds({ traceA: 'a'.repeat(32), traceB: 'b'.repeat(32) }, (line) => lines.push(line));
    const printed = lines.join('\n');
    expect(printed).toContain('a'.repeat(32));
    expect(printed).toContain('b'.repeat(32));
  });

  it('reads the spans of both Tempo answer shapes, with hex or base64 ids', () => {
    const hexParent = '0000000000000001';
    const base64Parent = Buffer.from(hexParent, 'hex').toString('base64');
    const attribute = { key: 'db.system.name', value: { stringValue: 'postgresql' } };
    const batches = spansOfTempo({
      batches: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: TRACE,
                  spanId: '0000000000000002',
                  parentSpanId: base64Parent,
                  name: 'SELECT',
                  attributes: [attribute],
                },
              ],
            },
          ],
        },
      ],
    });
    const resourceSpans = spansOfTempo({
      resourceSpans: [
        {
          instrumentationLibrarySpans: [
            {
              spans: [{ traceId: TRACE, spanId: '0000000000000003', parentSpanId: hexParent, name: 'POST' }],
            },
          ],
        },
      ],
    });

    expect(batches).toMatchObject([
      { traceId: TRACE, spanId: '0000000000000002', parentSpanId: hexParent, name: 'SELECT' },
    ]);
    expect(batches[0]?.attributes).toStrictEqual({ 'db.system.name': 'postgresql' });
    expect(resourceSpans).toMatchObject([
      { spanId: '0000000000000003', parentSpanId: hexParent, name: 'POST' },
    ]);
  });

  it('checks the OBS-08 edges of trace A and names the edge that is missing', () => {
    expect(() => assertTraceA(traceA())).not.toThrow();

    const withoutDelivery = traceA();
    const missing: Trace = { ...withoutDelivery, spans: withoutDelivery.spans.slice(0, -1) };
    expect(() => assertTraceA(missing)).toThrow(/platform\.stream\.deliver/u);
  });

  it('checks the OBS-12 edges of trace B and names the edge that is missing', () => {
    expect(() => assertTraceB(traceB())).not.toThrow();

    const withoutRelay = traceB();
    const missing: Trace = {
      ...withoutRelay,
      spans: withoutRelay.spans.filter((item) => item.name !== NAMES.relay),
    };
    expect(() => assertTraceB(missing)).toThrow(/platform\.outbox\.relay/u);
  });

  it('the leak scan flags a forbidden key, a query string and the player name, and passes a clean export', () => {
    const clean: ExportedRecord[] = [
      span('0000000000000021', '', 'POST', { 'http.route': '/v1/x', 'url.path': '/v1/x' }),
      { kind: 'metric', name: 'outbox_lag_seconds', labels: { service_name: 'd2rmm-api' } },
      { kind: 'log', line: '{"msg":"ok","trace_id":"abc"}' },
    ];
    expect(leaksIn(clean, PLAYER)).toStrictEqual([]);

    const leaking: ExportedRecord[] = [
      span('0000000000000022', '', 'POST', { 'client.address': '10.0.0.1' }),
      span('0000000000000023', '', 'GET', { 'http.url': 'http://127.0.0.1/x?code=1' }),
      span('0000000000000024', '', 'POST', { 'd2r.room.id': `room of ${PLAYER}` }),
      { kind: 'log', line: `{"msg":"joined","req":{"headers":{"cookie":"s"}}}` },
    ];
    const leaks = leaksIn(leaking, PLAYER);
    expect(leaks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('client.address'),
        expect.stringContaining('query string or fragment in http.url'),
        expect.stringContaining('player name in d2r.room.id'),
        expect.stringContaining('cookie'),
      ]),
    );
  });
});
