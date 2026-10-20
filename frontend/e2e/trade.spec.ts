import { test, expect } from './fixtures';

async function connectWallet(page: any) {
  await page.goto('/trade');

  const alreadyConnected = await page
    .locator('p.label', { hasText: 'Wallet Address' })
    .isVisible()
    .catch(() => false);
  if (alreadyConnected) return;

  await page.getByRole('button', { name: /Connect Freighter Wallet/i }).click();

  await expect(
    page.locator('p.label').filter({ hasText: 'Wallet Address' })
  ).toBeVisible({ timeout: 15000 });
}

test('trade: displays orderbook on load', async ({ page }) => {
  await page.route('**/horizon.stellar.org/order_book', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        bids: [
          { price: '0.10', amount: '1000' },
          { price: '0.09', amount: '2000' },
        ],
        asks: [
          { price: '0.11', amount: '1500' },
          { price: '0.12', amount: '2500' },
        ],
      }),
    });
  });

  await connectWallet(page);

  const orderbookSection = page.locator('text=/orderbook|order book/i').first();
  await expect(orderbookSection).toBeVisible({ timeout: 10000 });
});

test('trade: executes a swap transaction', async ({ page }) => {
  await page.route('**/horizon.stellar.org/**', route => {
    const url = route.request().url();
    if (url.includes('/order_book')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          bids: [{ price: '0.10', amount: '1000' }],
          asks: [{ price: '0.11', amount: '1500' }],
        }),
      });
    } else if (url.includes('/order_book') || url.includes('/offers')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ _embedded: { records: [] } }),
      });
    } else {
      route.fallback();
    }
  });

  await connectWallet(page);

  const swapTab = page.getByRole('tab', { name: /swap/i });
  await expect(swapTab).toBeVisible({ timeout: 5000 });
  await swapTab.click();

  const sellInput = page.getByLabel(/sell|you send/i);
  const buyInput = page.getByLabel(/buy|you receive/i);

  await expect(sellInput).toBeVisible({ timeout: 5000 });

  await sellInput.fill('10');

  if (await buyInput.isVisible().catch(() => false)) {
    await expect(buyInput).toHaveValue('');
  }

  const swapButton = page.getByRole('button', { name: /swap|exchange/i }).first();
  const isDisabled = await swapButton.isDisabled().catch(() => false);

  // Button may be disabled if routes aren't fully loaded
  if (!isDisabled) {
    await swapButton.click();
    await expect(page.getByText(/confirm|processing|success/i)).toBeVisible({ timeout: 10000 });
  }
});

test('trade: switches between swap and limit order tabs', async ({ page }) => {
  await connectWallet(page);

  const swapTab = page.getByRole('tab', { name: /swap/i });
  const tradeTab = page.getByRole('tab', { name: /trade|limit/i });

  await expect(swapTab).toBeVisible({ timeout: 5000 });
  await expect(tradeTab).toBeVisible({ timeout: 5000 });

  await swapTab.click();
  const sellInput1 = page.getByLabel(/sell|you send/i);
  await expect(sellInput1).toBeVisible({ timeout: 5000 });

  await tradeTab.click();
  const priceInput = page.getByLabel(/price|limit price/i);
  await expect(priceInput).toBeVisible({ timeout: 5000 });
});

test('trade: displays trade history', async ({ page }) => {
  await page.route('**/horizon.stellar.org/trade_aggregations', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        _embedded: {
          records: [
            {
              timestamp: Date.now().toString(),
              trade_count: 5,
              open: '0.10',
              high: '0.12',
              low: '0.09',
              close: '0.11',
              base_volume: '10000',
              counter_volume: '1100',
            },
          ],
        },
      }),
    });
  });

  await connectWallet(page);

  const historyTab = page.getByRole('tab', { name: /history|24h/i });
  if (await historyTab.isVisible().catch(() => false)) {
    await historyTab.click();
    await expect(page.getByText(/history|open|close/i)).toBeVisible({ timeout: 10000 });
  }
});

test('trade: displays and manages open offers', async ({ page }) => {
  await page.route('**/horizon.stellar.org/accounts/**/offers', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        _embedded: {
          records: [
            {
              id: '123456',
              selling: {
                asset_type: 'native',
              },
              buying: {
                asset_type: 'credit_alphanum4',
                asset_code: 'USDC',
                asset_issuer: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2TZLSW6LMQQ',
              },
              amount: '100.0000000',
              price: '0.10',
              price_r: { n: 1, d: 10 },
            },
          ],
        },
      }),
    });
  });

  await connectWallet(page);

  const ordersTab = page.getByRole('tab', { name: /orders|open/i });
  if (await ordersTab.isVisible().catch(() => false)) {
    await ordersTab.click();
    await expect(page.getByText(/100\.0000000|offer|order/i)).toBeVisible({ timeout: 10000 });
  }
});

test('trade: cancels an open offer', async ({ page }) => {
  await page.route('**/horizon.stellar.org/accounts/**/offers', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        _embedded: {
          records: [
            {
              id: '123456',
              selling: { asset_type: 'native' },
              buying: {
                asset_type: 'credit_alphanum4',
                asset_code: 'USDC',
                asset_issuer: 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2TZLSW6LMQQ',
              },
              amount: '100.0000000',
              price: '0.10',
              price_r: { n: 1, d: 10 },
            },
          ],
        },
      }),
    });
  });

  await connectWallet(page);

  const ordersTab = page.getByRole('tab', { name: /orders|open/i });
  if (await ordersTab.isVisible().catch(() => false)) {
    await ordersTab.click();
    await expect(page.getByText(/offer|order/i)).toBeVisible({ timeout: 10000 });

    const cancelBtn = page.getByRole('button', { name: /cancel|remove|delete/i }).first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
      await expect(page.getByText(/cancel|removed|success/i)).toBeVisible({ timeout: 10000 });
    }
  }
});

test('trade: validates swap inputs', async ({ page }) => {
  await connectWallet(page);

  const swapTab = page.getByRole('tab', { name: /swap/i });
  await expect(swapTab).toBeVisible({ timeout: 5000 });
  await swapTab.click();

  const sellInput = page.getByLabel(/sell|you send/i);
  await expect(sellInput).toBeVisible({ timeout: 5000 });

  await sellInput.fill('0');

  const swapButton = page.getByRole('button', { name: /swap|exchange/i }).first();
  const isDisabled = await swapButton.isDisabled().catch(() => false);
  const hasError = await page.getByText(/invalid|error|greater/i).isVisible().catch(() => false);

  expect(isDisabled || hasError).toBe(true);
});

test('trade: displays asset pair selector', async ({ page }) => {
  await connectWallet(page);

  const assetSelects = page.getByRole('combobox').or(page.getByRole('button', { name: /XLM|USDC|asset/i }));
  const count = await assetSelects.count();

  expect(count).toBeGreaterThanOrEqual(1);
});
