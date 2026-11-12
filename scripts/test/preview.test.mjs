// ADR 030: the preview service of a pull request is found by parent and name; only a Render preview origin is trusted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bakeOrigin,
  branchAlias,
  pickPreviewService,
  previewApiOriginFor,
  previewSiteOrigin,
  validPreviewOrigin,
} from '../preview/preview.mjs';

test('the branch alias lowercases and turns every character outside [a-z0-9] into a dash, trimmed', () => {
  assert.equal(branchAlias('phase/F1'), 'phase-f1');
  assert.equal(branchAlias('feat/F1-Room_x'), 'feat-f1-room-x');
  assert.equal(branchAlias('chore/F1-api-previews'), 'chore-f1-api-previews');
  assert.equal(branchAlias('/-Odd..Name-/'), 'odd--name');
  assert.equal(branchAlias(undefined), '');
});

test('the preview site origin is the alias under the project, and malformed inputs give nothing', () => {
  assert.equal(previewSiteOrigin('phase/F1', 'd2rmatchmaking'), 'https://phase-f1.d2rmatchmaking.pages.dev');
  assert.equal(previewSiteOrigin('///', 'd2rmatchmaking'), undefined);
  assert.equal(previewSiteOrigin('phase/F1', undefined), undefined);
  assert.equal(previewSiteOrigin('phase/F1', 'x.evil.test/'), undefined);
  assert.equal(previewSiteOrigin('phase/F1', 'Upper'), undefined);
});

test('a labelled open pull request gives its preview API origin, none gives none', () => {
  assert.equal(previewApiOriginFor([{ number: 12 }]), 'https://d2rmm-api-pr-12.onrender.com');
  assert.equal(previewApiOriginFor([{ number: 12 }, { number: 9 }]), 'https://d2rmm-api-pr-9.onrender.com');
  assert.equal(previewApiOriginFor([]), undefined);
  assert.equal(previewApiOriginFor(undefined), undefined);
  assert.equal(previewApiOriginFor([{ number: 0 }, { number: '7' }, {}]), undefined);
});

test('baking replaces only the committed default and refuses anything else', () => {
  const text = 'a\nexport const PREVIEW_API_ORIGIN: string | undefined = undefined;\nb\n';
  const baked = bakeOrigin(text, 'https://d2rmm-api-pr-3.onrender.com');
  assert.ok(baked.includes("= 'https://d2rmm-api-pr-3.onrender.com';"));
  assert.throws(() => bakeOrigin(text, 'https://evil.test'));
  assert.throws(() => bakeOrigin(baked, 'https://d2rmm-api-pr-4.onrender.com'));
});

const svc = (name, parent, url = `https://${name}.onrender.com`) => ({
  cursor: `c-${name}`,
  service: {
    id: `srv-${name}`,
    name,
    serviceDetails: { url, parentServer: parent ? { id: 'srv-base', name: parent } : undefined },
  },
});

test('picks the preview of the pull request by parent and name', () => {
  const list = [
    svc('d2rmm-api', undefined),
    svc('d2rmm-api-pr-12', 'd2rmm-api'),
    svc('d2rmm-api-pr-7', 'd2rmm-api'),
  ];
  assert.equal(pickPreviewService(list, 7)?.id, 'srv-d2rmm-api-pr-7');
  assert.equal(pickPreviewService(list, 12)?.id, 'srv-d2rmm-api-pr-12');
});

test('returns undefined when the preview is absent', () => {
  assert.equal(pickPreviewService([svc('d2rmm-api', undefined)], 7), undefined);
  assert.equal(pickPreviewService([], 7), undefined);
  assert.equal(pickPreviewService(undefined, 7), undefined);
});

test('does not match a prefix of the number, another parent, or a missing parent', () => {
  assert.equal(pickPreviewService([svc('d2rmm-api-pr-12', 'd2rmm-api')], 1), undefined);
  assert.equal(pickPreviewService([svc('d2rmm-api-pr-7', 'other')], 7), undefined);
  assert.equal(pickPreviewService([svc('d2rmm-api-pr-7', undefined)], 7), undefined);
});

test('rejects an invalid pull request number', () => {
  const list = [svc('d2rmm-api-pr-7', 'd2rmm-api')];
  assert.equal(pickPreviewService(list, 0), undefined);
  assert.equal(pickPreviewService(list, 7.5), undefined);
  assert.equal(pickPreviewService(list, Number.NaN), undefined);
});

test('accepts bare services as well as wrapped entries', () => {
  assert.equal(pickPreviewService([svc('d2rmm-api-pr-7', 'd2rmm-api').service], 7)?.id, 'srv-d2rmm-api-pr-7');
});

test('accepts only https://d2rmm-api-pr-<digits>.onrender.com', () => {
  assert.equal(
    validPreviewOrigin('https://d2rmm-api-pr-42.onrender.com'),
    'https://d2rmm-api-pr-42.onrender.com',
  );
  for (const bad of [
    undefined,
    '',
    'http://d2rmm-api-pr-42.onrender.com',
    'https://d2rmm-api-pr-.onrender.com',
    'https://d2rmm-api-pr-4a.onrender.com',
    'https://d2rmm-api-pr-42.onrender.com/',
    'https://d2rmm-api-pr-42.onrender.com/x',
    'https://d2rmm-api-pr-42.onrender.com:8443',
    'https://d2rmm-api-pr-42.onrender.com.evil.test',
    'https://evil.test/d2rmm-api-pr-42.onrender.com',
    'https://x.d2rmm-api-pr-42.onrender.com',
    'https://d2rmm-api.onrender.com',
    'https://d2rmm-api-pr-42.onrender.com\n',
  ]) {
    assert.equal(validPreviewOrigin(bad), undefined, String(bad));
  }
});
