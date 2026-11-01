// Site-wide and health steps of api-web-skeleton (AWS-17, AWS-30, AWS-37, AWS-38), and the visible-text steps every
// site scenario shares. Black box: the browser and HTTP only. Each pattern is anchored, so one line matches one step.
import { expect } from '@playwright/test';
import { Given, Then, When } from '../fixtures.ts';

/** Every quoted text of a step line, in order. */
function quoted(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
}

// AWS-30: the API answers its health check.
When('a client asks the API for its health', async ({ world }) => {
  const response = await fetch(`${world.stack.staging.api}/healthz`, { signal: AbortSignal.timeout(10_000) });
  world.last = { status: response.status, body: await response.json().catch(() => undefined) };
});

Then('the API answers that it is ok', ({ world }) => {
  expect(world.last?.status, 'the health status').toBe(200);
  expect(world.last?.body, 'the health body').toEqual({ status: 'ok' });
});

// AWS-37: the site follows the browser's language. The context's locale is what navigator.languages reports.
Given(/^the browser prefers "(.+)"$/, ({ world }, language: string) => {
  world.locale = language;
});

// Opens the site in a new visitor's browser and waits for the first view of the site.
When('a visitor opens the site', async ({ world }) => {
  const visitor = await world.newVisitor();
  await world.openSite(visitor);
});

// AWS-17: the download button points to the latest agent release.
Then(/^"(.+)" links to "(.+)"$/, async ({ world }, name: string, href: string) => {
  const link = world.currentVisitor.page.getByRole('link', { name, exact: true });
  await expect(link, `the link "${name}"`).toHaveAttribute('href', href);
});

// Actions are links or buttons: the site names them with the same words in both roles.
Then(/^the site shows the action "(.+)"$/, async ({ world }, name: string) => {
  const page = world.currentVisitor.page;
  const link = page.getByRole('link', { name, exact: true });
  const button = page.getByRole('button', { name, exact: true });
  await expect(link.or(button).first(), `the action "${name}"`).toBeVisible();
});

// Visible text. `getByText` with `exact` matches the whole text of an element, never a part of it.
Then(/^the site shows "([^"]+)"$/, async ({ world }, text: string) => {
  await expect(world.currentVisitor.page.getByText(text, { exact: true }), `"${text}"`).toBeVisible();
});

Then(/^the site shows no "([^"]+)" text$/, async ({ world }, text: string) => {
  await expect(world.currentVisitor.page.getByText(text), `no "${text}"`).toHaveCount(0);
});

// Several texts within the time the spec allows (NFR-01: 2 seconds).
Then(/^within 2 seconds the site shows ((?:"[^"]*"(?:, | and )?)+)$/, async ({ world }, list: string) => {
  const page = world.currentVisitor.page;
  for (const text of quoted(list)) {
    await expect(page.getByText(text, { exact: true }), `"${text}" within 2 seconds`).toBeVisible({
      timeout: 2_000,
    });
  }
});

// AGS-30: a note sits next to a link, in the same container as the link (the site's header).
Then(/^the site shows "([^"]+)" next to "([^"]+)"$/, async ({ world }, note: string, name: string) => {
  const link = world.currentVisitor.page.getByRole('link', { name, exact: true });
  await expect(link, `the link "${name}"`).toBeVisible();
  await expect(
    link.locator('xpath=..').getByText(note, { exact: true }),
    `"${note}" next to "${name}"`,
  ).toBeVisible();
});
