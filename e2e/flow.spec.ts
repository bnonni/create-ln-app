import { expect, test, type Page } from '@playwright/test';

// The test does the browser steps of the example app: select a node, connect a peer, open a channel,
// confirm it, request an invoice, pay it with WebLN, pay a Lightning Address, and send sats with a withdraw link.
// Each run opens a new channel, so the test also passes if a channel already exists.
// On regtest, step 3 mines blocks. On Mutinynet, step 3 waits for the blocks, so the test can take 10 min.
// To use a different node pair, set FLOW_NODES, for example `FLOW_NODES=bob,alice npm run test:e2e`.
const [NODE, PEER, ...otherNodes] = (process.env.FLOW_NODES ?? 'alice,bob').split(',').map((name) => name.trim());
if (!NODE || !PEER || NODE === PEER || otherNodes.length > 0) {
  throw new Error(`FLOW_NODES must be 2 different node names, for example alice,bob. It is: ${process.env.FLOW_NODES}`);
}
// The channel size and the invoice prefix of each network (see frontend/src/components/Page.tsx).
const NETWORKS: Record<string, { channel: string; invoice: RegExp }> = {
  regtest: { channel: '1,000,000', invoice: /^lnbcrt/ },
  mutinynet: { channel: '100,000', invoice: /^lntbs/ },
};
const MUTINYNET_WAIT_MS = 10 * 60_000;

// The box of one step. `title` is the start of the step text, for example "1. Connect".
const step = (page: Page, title: string) => page.locator('.step', { hasText: title });

// Click the button of a step, then wait for the result text.
// If the step shows an API error, the failure message shows the error text.
const runStep = async (page: Page, title: string, button: string, result: RegExp, timeout?: number) => {
  const box = step(page, title);
  await box.getByRole('button', { name: button }).click();
  await expect(box.locator('.result, .error')).toHaveText(result, { timeout });
};

test('a node pays a peer over a new channel', async ({ page, request }) => {
  // If the network does not run, stop now. The failure message shows the API error.
  const nodes = await request.get('/api/nodes');
  expect(nodes, await nodes.text()).toBeOK();
  const { network } = await (await request.get('/api/network')).json();
  const expected = NETWORKS[network];
  expect(expected, `unknown network: ${network}`).toBeDefined();
  if (network === 'mutinynet') test.setTimeout(MUTINYNET_WAIT_MS + 120_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.locator('#node-select').selectOption(NODE);
  await expect(page.locator('.node-info')).toBeVisible();

  await page.locator('#peer-select').selectOption(PEER);
  await runStep(page, '1. Connect', 'Connect', new RegExp(`${NODE} is connected to ${PEER}`));

  await runStep(page, '2. Open', 'Open channel', new RegExp(`${NODE} opened a ${expected.channel} sat channel to ${PEER}`));

  if (network === 'mutinynet') {
    await runStep(page, '3. Wait', 'Wait for channel', /is active/, MUTINYNET_WAIT_MS);
  } else {
    await runStep(page, '3. Mine', 'Mine blocks', /bitcoind mined 6 blocks/);
  }
  // LND needs some time to see the blocks. Load the nodes again until no channel is pending.
  const nodeInfo = page.locator('.node-info');
  await expect(async () => {
    await step(page, 'Who are you?').getByRole('button', { name: 'Refresh' }).click();
    await expect(nodeInfo.getByRole('cell', { name: 'pending', exact: true })).toHaveCount(0, { timeout: 1000 });
    await expect(nodeInfo.getByRole('cell', { name: 'active', exact: true })).not.toHaveCount(0, { timeout: 1000 });
  }).toPass();

  await runStep(page, '4. Request', 'Request invoice', new RegExp(`${PEER} made an invoice for 1,000 sats`));
  await expect(page.getByLabel('Payment request')).toHaveValue(expected.invoice);
  await expect(page.getByText('Invoice status: open')).toBeVisible();

  await runStep(page, '5. Pay', 'Pay invoice', new RegExp(`${NODE} paid 1,000 sats to ${PEER} with webln`));
  // Step 4 loads the invoice status each second.
  await expect(page.getByText('Invoice status: settled')).toBeVisible();

  await runStep(page, '6. Pay', 'Pay address', new RegExp(`${NODE} paid 1,000 sats to ${PEER}@`));

  await runStep(page, '7. Send', 'Make link', new RegExp(`${NODE} made a withdraw link for 1,000 sats`));
  await expect(page.getByLabel('Withdraw link')).toHaveValue(/^LNURL1/);
  await runStep(page, '7. Send', 'Claim link', new RegExp(`${PEER} claimed the link. ${NODE} paid 1,000 sats`));

  expect(pageErrors).toEqual([]);
});
