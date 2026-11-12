import { test, expect } from '@playwright/test';
import { login } from './helpers';

/** FAZ 2 — global search / command palette. Verifies the "(yakında)" stub is
 *  gone, the palette opens, finds a partner, and Enter navigates to it. */
test('global search: komut paleti açılır, cari bulur ve gider', async ({ page }) => {
  test.slow();
  await login(page);

  // the old disabled stub must be gone
  await expect(page.getByText('Ara… (yakında)')).toHaveCount(0);

  // open via the header button (⌘K also works; button is the stable e2e path)
  await page.getByTestId('global-search').click();
  const input = page.getByTestId('global-search-input');
  await expect(input).toBeVisible();

  // empty query shows the quick-action group
  await expect(page.getByText('Eylemler')).toBeVisible();

  // typing a customer term surfaces the Cariler group
  await input.fill('otel');
  const results = page.getByTestId('global-search-results');
  await expect(results.getByText('Cariler')).toBeVisible({ timeout: 30_000 });

  // Enter opens the top hit
  await input.press('Enter');
  await page.waitForURL(/\?id=|\/quotes\/|\/orders\/|\/partners\//, { timeout: 30_000 });
});
