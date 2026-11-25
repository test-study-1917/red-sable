import { readFile } from 'node:fs/promises';

import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test, SIGNED_OUT } from './fixtures/test';

test.use({ storageState: SIGNED_OUT, hasTouch: true, viewport: { width: 320, height: 700 } });

test('mobile: file rows download and jump without opening the viewer', async ({
  app,
  page,
  installRoomCore,
}, testInfo) => {
  const filename = '会议资料—城市文化与公共空间研究讨论稿（第十二次修订）.txt';
  const eventId = '$general-8:example.test';
  const source = 'mxc://example.test/meeting-notes';
  const text = 'Original meeting notes';
  await page.addInitScript(
    ({ eventId, filename, source, text }) => {
      window.__e2eRoomAttachments = [
        {
          event_id: eventId,
          gallery_index: null,
          sender: '@alice:example.test',
          timestamp: 1_700_000_000_000,
          content: { kind: 'file', filename, source, mime: 'text/plain', size: text.length },
        },
      ];
      window.__e2eFetchMedia = (requestedSource, width, height) => {
        if (requestedSource !== source || width !== 0 || height !== 0) {
          throw new Error('Expected the original attachment');
        }
        return Promise.resolve(new TextEncoder().encode(text));
      };
    },
    { eventId, filename, source, text }
  );
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');

  await page.locator('.room-header').getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: en.timeline.attachmentsTitle }).click();
  const panel = page.getByRole('dialog', { name: en.timeline.attachmentsTitle });
  await panel.getByRole('tab', { name: en.timeline.attachmentsFiles }).click();
  const download = panel.getByRole('button', { name: `${en.common.download}: ${filename}` });
  const jump = panel.getByRole('button', { name: `${en.common.jumpToMessage}: ${filename}` });
  await expect(download).toBeInViewport();
  await expect(jump).toBeInViewport();
  const fileButtons = panel.getByRole('listitem').getByRole('button');
  await expect(fileButtons).toHaveCount(3);
  for (const button of await fileButtons.all()) {
    await expect(button).toHaveCSS('scroll-margin-block-start', '48px');
  }
  const downloadBox = await download.boundingBox();
  const jumpBox = await jump.boundingBox();
  if (!downloadBox || !jumpBox) throw new Error('Both file shortcuts must have bounds');
  expect(downloadBox.width).toBeGreaterThanOrEqual(48);
  expect(jumpBox.width).toBeGreaterThanOrEqual(48);
  expect(downloadBox.x + downloadBox.width).toBeLessThanOrEqual(jumpBox.x);
  expect(jumpBox.x + jumpBox.width).toBeLessThanOrEqual(320);
  await panel.screenshot({ path: testInfo.outputPath('file-attachments-mobile.png') });

  const downloaded = page.waitForEvent('download');
  await download.tap();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe(filename);
  expect(await readFile(await file.path(), 'utf8')).toBe(text);
  await expect(page.getByRole('dialog', { name: en.viewer.title })).toHaveCount(0);
  await expect(panel).toBeVisible();

  await jump.tap();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL((url) => url.searchParams.get('event') === eventId);
  await expect(page.locator('.highlighted')).toContainText('General message 8');
});
