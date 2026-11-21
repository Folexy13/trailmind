import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist');

test.describe('Trailmind Unpacked Chrome MV3 Extension (NFR-MT-2)', () => {
  test('loads unpacked extension, renders Onboarding, navigates views, and renders Popup', async () => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    try {
      let [serviceWorker] = context.serviceWorkers();
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
      }
      const extensionId = serviceWorker.url().split('/')[2];
      expect(extensionId).toBeTruthy();

      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/app.html#onboarding`);
      await expect(page.getByText('Your browsing, remembered. On your device.')).toBeVisible();

      // Advance through onboarding steps and open main app
      await page.getByRole('button', { name: /Continue/i }).click();
      await page.getByRole('button', { name: /Continue/i }).click();
      await page.getByRole('button', { name: /Skip import/i }).click();

      // Verify core tabs render cleanly
      await page.getByRole('button', { name: /Ask Memory/i }).click();
      await expect(page.getByPlaceholder(/Ask anything/i)).toBeVisible();

      await page.getByRole('button', { name: /Decisions & Radar/i }).click();
      await expect(page.getByText(/Hybrid Decision Matrix/i)).toBeVisible();

      await page.getByRole('button', { name: /Tab Rescue/i }).click();
      await expect(page.getByText(/Tab Graveyard Rescue/i)).toBeVisible();

      // Open Popup & verify recording status + quick forget controls
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect(popupPage.getByText('Trailmind')).toBeVisible();
      await expect(popupPage.getByRole('button', { name: /Forget 15m/i })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
