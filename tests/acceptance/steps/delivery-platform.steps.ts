// Steps of delivery-platform (DLP-07): the site waits for a sleeping API instead of failing. The API's first answers
// are stubbed in the browser, so the stack's real API stays up for the other scenarios. DLP-04's steps are in
// site.steps.ts, beside the health steps they extend.
import { expect } from '@playwright/test';
import { Given, Then, When } from '../fixtures.ts';

/** How long the stubbed API answers 502, from the moment the player opens the site. */
const SLEEP_MS = 20_000;
/** The site retries for up to 90 s (DLP-07); the wait here is shorter than the scenario's 60 s timeout. */
const WAKING_TEXT = /Waking the server|Acordando o servidor/;

const sleepingSeconds = new WeakMap<object, number>();

Given(
  /^the API answers 502 for the first (\d+) seconds, then answers normally$/,
  ({ world }, seconds: string) => {
    sleepingSeconds.set(world, Number(seconds) * 1000);
  },
);

When('a player opens the site', async ({ world }) => {
  const visitor = await world.newVisitor();
  const sleepsFor = sleepingSeconds.get(world) ?? SLEEP_MS;
  const opened = Date.now();
  // The first read the site makes is /v1/config, through the /api/* proxy. Every call inside the window answers 502, as
  // Render does while a free service starts; afterwards the call goes to the real API.
  await visitor.page.route('**/api/v1/**', async (route) => {
    if (Date.now() - opened < sleepsFor) {
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' });
    } else {
      await route.continue();
    }
  });
  await visitor.page.goto(`${world.site.site}/`);
});

Then('the site says the server is waking up', async ({ world }) => {
  await expect(world.currentVisitor.page.getByText(WAKING_TEXT), 'the waking message').toBeVisible({
    timeout: 15_000,
  });
});

Then('the site loads normally once the API answers', async ({ world }) => {
  const page = world.currentVisitor.page;
  await expect(page.getByText(WAKING_TEXT), 'the waking message is gone').toHaveCount(0, { timeout: 40_000 });
  await expect(page.getByRole('alert'), 'no error is shown').toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'D2R Match Making' }).or(page.getByText('D2R Match Making').first()),
  ).toBeVisible();
});
