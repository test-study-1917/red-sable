import { expect, test, SIGNED_OUT } from './fixtures/test';
import { COLD_BOOT_TIMEOUT } from './pages/AppShell';

test.use({ storageState: SIGNED_OUT });

test('notification history retains a mention after marking it read', async ({
  page,
  installRoomCore,
}) => {
  await installRoomCore('ready');
  await page.goto('/inbox?tab=notifications');
  const history = page.getByRole('region', { name: '通知记录', exact: true });
  await expect(history).toBeVisible({ timeout: COLD_BOOT_TIMEOUT });
  await expect(history.locator('.notification-entry')).toHaveCount(1);
  await expect(history.locator('.unread-mark')).toHaveCount(1);
  await history.getByRole('button', { name: '全部标为已读', exact: true }).click();
  await expect(history.locator('.unread-mark')).toHaveCount(0);
  await expect(history.locator('.notification-entry')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__e2eCalls.some((call) => call.method === 'notifications.mark_notification_seen')
      )
    )
    .toBe(true);
  await page.screenshot({ path: 'test-results/focused-inbox.png', fullPage: true });
  await history.getByRole('button', { name: '仅未读', exact: true }).click();
  await expect(history.locator('.notification-entry')).toHaveCount(0);
});
