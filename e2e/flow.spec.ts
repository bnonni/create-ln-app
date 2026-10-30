import { expect, test, type Page } from '@playwright/test';

// The test does the browser steps of the example app: select a node, connect a peer, open a channel,
// mine blocks, request an invoice, and pay it.
// Each run opens a new channel, so the test also passes if a channel already exists.
const NODE = 'alice';
const PEER = 'bob';

// The box of one step. `title` is the start of the step text, for example "1. Connect".
const step = (page: Page, title: string) => page.locator('.step', { hasText: title });

// Click the button of a step, then wait for the result text.
// If the step shows an API error, the failure message shows the error text.
const runStep = async (page: Page, title: string, button: string, result: RegExp) => {
  const box = step(page, title);
  await box.getByRole('button', { name: button }).click();
  await expect(box.locator('.result, .error')).toHaveText(result);
};

test('a node pays an invoice from a peer over a new channel', async ({ page, request }) => {
  // If the network does not run, stop now. The failure message shows the API error.
  const nodes = await request.get('/api/nodes');
  expect(nodes, await nodes.text()).toBeOK();

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.locator('#node-select').selectOption(NODE);
  await expect(page.locator('.node-info')).toBeVisible();

  await page.locator('#peer-select').selectOption(PEER);
  await runStep(page, '1. Connect', 'Connect', new RegExp(`${NODE} is connected to ${PEER}`));

  await runStep(page, '2. Open', 'Open channel', new RegExp(`${NODE} opened a 1,000,000 sat channel to ${PEER}`));

  await runStep(page, '3. Mine', 'Mine blocks', /bitcoind mined 6 blocks/);
  // LND needs some time to see the blocks. Load the nodes again until no channel is pending.
  const nodeInfo = page.locator('.node-info');
  await expect(async () => {
    await step(page, 'Who are you?').getByRole('button', { name: 'Refresh' }).click();
    await expect(nodeInfo.getByRole('cell', { name: 'pending', exact: true })).toHaveCount(0, { timeout: 1000 });
    await expect(nodeInfo.getByRole('cell', { name: 'active', exact: true })).not.toHaveCount(0, { timeout: 1000 });
  }).toPass();

  await runStep(page, '4. Request', 'Request invoice', new RegExp(`${PEER} made an invoice for 1,000 sats`));
  await expect(page.getByLabel('Payment request')).toHaveValue(/^lnbcrt/);
  await expect(page.getByText('Invoice status: open')).toBeVisible();

  await runStep(page, '5. Pay', 'Pay invoice', new RegExp(`${NODE} paid 1,000 sats to ${PEER}`));
  // Step 4 loads the invoice status each second.
  await expect(page.getByText('Invoice status: settled')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
