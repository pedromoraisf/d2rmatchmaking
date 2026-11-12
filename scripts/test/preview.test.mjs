// ADR 030: the preview service of a pull request is found by parent and name; only a Render preview origin is trusted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bakeOrigin,
  describeServices,
  branchAlias,
  pickPreviewService,
  previewApiOriginFor,
  previewSiteOrigin,
  verifiedPreview,
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

const OWNER = 'pedromoraisf';
const own = (number) => ({ number, headRepositoryOwner: { login: OWNER } });

test('a fork pull request from a branch of the same name is ignored, even without an owner to compare', () => {
  const fork = { number: 5, headRepositoryOwner: { login: 'someone-else' } };
  assert.equal(previewApiOriginFor([fork], OWNER), undefined);
  assert.equal(previewApiOriginFor([fork, own(8)], OWNER), 'https://d2rmm-api-pr-8.onrender.com');
  assert.equal(previewApiOriginFor([own(8)], undefined), undefined);
  assert.equal(previewApiOriginFor([own(8)], ''), undefined);
  assert.equal(previewApiOriginFor([{ number: 8 }], OWNER), undefined);
});

test('an alias over 28 characters is refused, 28 is accepted', () => {
  assert.equal(previewSiteOrigin('a'.repeat(28), 'proj'), `https://${'a'.repeat(28)}.proj.pages.dev`);
  assert.equal(previewSiteOrigin('a'.repeat(29), 'proj'), undefined);
});

test('a found service is the preview only with the derived url and an id other than its parent', () => {
  const ok = svc('d2rmm-api-pr-7', 'd2rmm-api').service;
  assert.equal(verifiedPreview(ok, 7), true);
  assert.equal(
    verifiedPreview(
      { ...ok, serviceDetails: { ...ok.serviceDetails, url: 'https://d2rmm-api-pr-8.onrender.com' } },
      7,
    ),
    false,
  );
  assert.equal(verifiedPreview({ ...ok, id: 'srv-base' }, 7), false);
  assert.equal(
    verifiedPreview({ ...ok, serviceDetails: { ...ok.serviceDetails, parentServer: undefined } }, 7),
    false,
  );
  assert.equal(verifiedPreview(undefined, 7), false);
});

test('a labelled open pull request gives its preview API origin, none gives none', () => {
  assert.equal(previewApiOriginFor([own(12)], OWNER), 'https://d2rmm-api-pr-12.onrender.com');
  assert.equal(previewApiOriginFor([own(12), own(9)], OWNER), 'https://d2rmm-api-pr-9.onrender.com');
  assert.equal(previewApiOriginFor([], OWNER), undefined);
  assert.equal(previewApiOriginFor(undefined, OWNER), undefined);
  assert.equal(previewApiOriginFor([own(0), own('7'), {}], OWNER), undefined);
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

// Shapes of a Render list-services page. The real preview of PR #41 is named "d2rmm-api PR #41".
const base = {
  id: 'srv-base',
  name: 'd2rmm-api',
  type: 'web_service',
  serviceDetails: { url: 'https://d2rmm-api.onrender.com' },
};
const preview = (n, name = `d2rmm-api PR #${n}`, parent = { id: 'srv-base', name: 'd2rmm-api' }) => ({
  id: `srv-pr-${n}`,
  name,
  type: 'web_service',
  serviceDetails: { url: `https://d2rmm-api-pr-${n}.onrender.com`, parentServer: parent },
});
const wrapped = (...services) => services.map((service) => ({ cursor: `c-${service.id}`, service }));

test('picks a preview named "d2rmm-api PR #41" by url and parent id', () => {
  const list = wrapped(base, preview(12), preview(41));
  assert.equal(pickPreviewService(list, 41)?.id, 'srv-pr-41');
  assert.equal(pickPreviewService(list, 12)?.id, 'srv-pr-12');
});

test('still picks a preview with the old d2rmm-api-pr-<n> naming', () => {
  assert.equal(pickPreviewService(wrapped(base, preview(7, 'd2rmm-api-pr-7')), 7)?.id, 'srv-pr-7');
});

test('the base service alone, or an empty or malformed list, has no preview', () => {
  assert.equal(pickPreviewService(wrapped(base), 41), undefined);
  assert.equal(pickPreviewService([], 41), undefined);
  assert.equal(pickPreviewService(undefined, 41), undefined);
});

test('a foreign service at a look-alike url, another parent id, or another number is not the preview', () => {
  const foreign = preview(41);
  const lookAlike = (url) => ({ ...foreign, serviceDetails: { ...foreign.serviceDetails, url } });
  for (const url of [
    'https://d2rmm-api-pr-41.onrender.com.evil.test',
    'https://d2rmm-api-pr-410.onrender.com',
    'http://d2rmm-api-pr-41.onrender.com',
    'https://other-pr-41.onrender.com',
  ]) {
    assert.equal(pickPreviewService(wrapped(base, lookAlike(url)), 41), undefined, url);
  }
  const stranger = preview(41, 'x PR #41', { id: 'srv-other', name: 'other' });
  assert.equal(pickPreviewService(wrapped(base, stranger), 41), undefined);
  assert.equal(pickPreviewService(wrapped(base, preview(41, 'x', null)), 41), undefined);
  assert.equal(pickPreviewService(wrapped(base, preview(12)), 41), undefined);
});

test('without ids it falls back to the parent name, and with a base listed the parent id must match', () => {
  const noIds = preview(41, 'x', { name: 'd2rmm-api' });
  assert.equal(pickPreviewService(wrapped(noIds), 41)?.id, 'srv-pr-41');
  const otherName = {
    ...noIds,
    serviceDetails: { ...noIds.serviceDetails, parentServer: { name: 'other' } },
  };
  assert.equal(pickPreviewService(wrapped(otherName), 41), undefined);
  const wrongId = preview(41, 'x', { id: 'srv-zzz', name: 'd2rmm-api' });
  assert.equal(pickPreviewService(wrapped(base, wrongId), 41), undefined);
});

test('the base is the service named exactly d2rmm-api with no parent, not a preview of the same name', () => {
  const impostor = { ...preview(3), id: 'srv-imp', name: 'd2rmm-api' };
  const child = preview(41, 'x', { id: 'srv-imp', name: 'd2rmm-api' });
  // The impostor has a parent, so it is no base; with no base listed the fallback is the parent name, which matches.
  assert.equal(pickPreviewService(wrapped(impostor, child), 41)?.id, 'srv-pr-41');
  assert.equal(pickPreviewService(wrapped(impostor, base, child), 41), undefined);
});

test('rejects an invalid pull request number', () => {
  const list = wrapped(base, preview(7));
  assert.equal(pickPreviewService(list, 0), undefined);
  assert.equal(pickPreviewService(list, 7.5), undefined);
  assert.equal(pickPreviewService(list, Number.NaN), undefined);
});

test('accepts bare services as well as wrapped entries', () => {
  assert.equal(pickPreviewService([base, preview(7)], 7)?.id, 'srv-pr-7');
});

test('describeServices prints one line per service with no env vars', () => {
  const lines = describeServices(wrapped(base, { ...preview(41), envVars: [{ key: 'X', value: 'secret' }] }));
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('web_service') && lines[1].includes('d2rmm-api PR #41'));
  assert.ok(lines[1].includes('https://d2rmm-api-pr-41.onrender.com') && lines[1].includes('srv-base'));
  assert.ok(!lines.join('\n').includes('secret'));
  assert.deepEqual(describeServices(undefined), []);
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
