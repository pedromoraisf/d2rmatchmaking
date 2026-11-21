// Steps of agent-release (AGR-08, AGR-09): the code signing policy page and the SmartScreen note. The browser language and
// "a visitor opens the site" are the existing steps (site.steps.ts). The page is read in either language, so each text is
// matched in English and in Portuguese. The release workflows have no scenario: the runner proves them (spec, Requirement
// Traceability).
import { expect } from '@playwright/test';
import { Then, When } from '../fixtures.ts';

When('a visitor opens the code signing policy page', async ({ world }) => {
  const visitor = await world.newVisitor();
  await visitor.page.goto(`${world.site.site}/code-signing`);
});

When('the visitor follows the code signing policy link in the footer', async ({ world }) => {
  const footer = world.currentVisitor.page.getByRole('contentinfo');
  await footer.getByRole('link', { name: /Code signing policy|Política de assinatura de código/ }).click();
});

Then('the code signing policy page opens', async ({ world }) => {
  const page = world.currentVisitor.page;
  await expect(page).toHaveURL(/\/code-signing\/?$/);
  await expect(
    page.getByRole('heading', { name: /Code signing policy|Política de assinatura de código/, level: 2 }),
  ).toBeVisible();
});

Then('the page names the project and its licence', async ({ world }) => {
  const page = world.currentVisitor.page;
  await expect(page.getByText(/D2R Match Making/).first()).toBeVisible();
  await expect(page.getByText(/MIT/).first()).toBeVisible();
});

Then(
  'the page says free code signing is provided by SignPath.io with a certificate from SignPath Foundation',
  async ({ world }) => {
    const page = world.currentVisitor.page;
    await expect(page.getByText(/SignPath\.io/).first()).toBeVisible();
    await expect(page.getByText(/SignPath Foundation/).first()).toBeVisible();
  },
);

Then('the page lists who commits, who reviews and who approves a signing request', async ({ world }) => {
  const roles = world.currentVisitor.page.getByRole('region', { name: /Who signs|Quem assina/ });
  await expect(roles.getByRole('listitem')).toHaveCount(3);
  await expect(roles.getByRole('link').first()).toBeVisible();
});

Then(
  "the page says the agent reads only the game window's pixels and operating-system signals",
  async ({ world }) => {
    await expect(world.currentVisitor.page.getByText(/pixels/).first()).toBeVisible();
  },
);

Then('the page has a privacy statement', async ({ world }) => {
  const privacy = world.currentVisitor.page.getByRole('region', { name: /Privacy|Privacidade/ });
  await expect(privacy).toBeVisible();
  await expect(privacy.getByText(/networked systems|sistemas em rede/)).toBeVisible();
});

Then('the download link is shown with the SmartScreen note beside it', async ({ world }) => {
  const page = world.currentVisitor.page;
  const link = page.getByRole('link', { name: /Download the agent|Baixar o agente/ });
  await expect(link).toBeVisible();
  await expect(link.locator('xpath=..').getByText(/SmartScreen/)).toBeVisible();
});
