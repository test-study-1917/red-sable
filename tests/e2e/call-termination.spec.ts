import { expect, test } from '@playwright/test';
import type { CallTermination } from '#lib/features/call/call-session.svelte.js';

declare global {
  interface Window {
    callTerminationProbe: {
      sends: number;
      leaves: number;
      disconnects: number;
      fail: boolean;
      ended: CallTermination[];
      remoteEnd: () => void;
    };
  }
}

test('fake-core call: confirmation, retry and a normal end in the compact bar', async ({
  page,
}, testInfo) => {
  await page.goto('/tests/e2e/fixtures/call-termination.html');
  await page.getByRole('button', { name: 'Call ending options' }).click();
  await page.screenshot({ path: testInfo.outputPath('menu.png') });
  await page.getByRole('menuitem', { name: 'End call for everyone' }).click();
  await expect(page.getByRole('dialog', { name: 'End the call for everyone?' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('confirm.png') });
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => window.callTerminationProbe.sends)).toBe(0);
  await page.getByRole('button', { name: 'Call ending options' }).click();
  await page.getByRole('menuitem', { name: 'End call for everyone' }).click();
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not confirm');
  await page.screenshot({ path: testInfo.outputPath('failure.png') });
  await page.getByRole('button', { name: 'Switch view' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not confirm');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('alert')).toContainText('End not confirmed');
  await page.screenshot({ path: testInfo.outputPath('collapsed-failure.png') });
  console.info(`Call UI screenshots: ${testInfo.outputDir}`);
  await page.evaluate(() => {
    window.callTerminationProbe.fail = false;
  });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Call idle')).toBeVisible();
  const probe = await page.evaluate(() => {
    const { sends, leaves, disconnects, ended } = window.callTerminationProbe;
    return { sends, leaves, disconnects, ended };
  });
  expect(probe).toMatchObject({ sends: 2, leaves: 0, disconnects: 1, ended: [{ local: true }] });
});

test('fake-core call: remote end while compact tears down once', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/call-termination.html');
  await expect(page.getByRole('button', { name: 'Call ending options' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch view' }).click();
  await page.evaluate(() => {
    window.callTerminationProbe.remoteEnd();
  });
  await expect(page.getByText('Call idle')).toBeVisible();
  const probe = await page.evaluate(() => {
    const { sends, leaves, disconnects, ended } = window.callTerminationProbe;
    return { sends, leaves, disconnects, ended };
  });
  expect(probe).toMatchObject({ sends: 0, leaves: 0, disconnects: 1, ended: [{ local: false }] });
});
