import { readFile } from 'node:fs/promises';
import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test, SIGNED_OUT } from './fixtures/test';
import { timelineItem } from './fixtures/timeline-items';

test.use({ storageState: SIGNED_OUT });

test('room history filters and downloads TXT, Markdown and HTML', async ({
  page,
  app,
  core,
  installRoomCore,
}) => {
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  await core.emitTimelineDiff(await core.subscription(), [
    {
      op: 'reset',
      values: [
        timelineItem('export-one', 'Export this passage https://example.org/'),
        timelineItem('export-two', 'Do not include this message'),
      ],
    },
  ]);
  await page.getByRole('button', { name: en.common.searchMessages, exact: true }).click();
  await page.getByRole('button', { name: '查看及导出聊天记录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '聊天记录', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: '搜索聊天记录' }).fill('Export this passage');
  await expect(dialog.locator('.history-message')).toHaveCount(1);
  await expect(dialog.locator('.history-message')).toContainText('Export this passage');
  await expect(dialog.locator('.history-stat')).toContainText('已达时间线边界');
  for (const [label, extension] of [
    ['TXT (.txt)', 'txt'],
    ['Markdown (.md)', 'md'],
    ['HTML (.html)', 'html'],
  ] as const) {
    await dialog.getByRole('button', { name: '导出聊天记录 ▾', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: label, exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    const path = await download.path();
    expect(path).not.toBeNull();
    if (path === null) throw new Error('The history download did not produce a file');
    const content = await readFile(path, 'utf8');
    expect(content).toContain('Export this passage');
    expect(content).not.toContain('Do not include this message');
  }
  await page.screenshot({ path: 'test-results/chat-history-export.png', fullPage: true });
  await dialog.getByRole('button', { name: '关闭聊天记录' }).click();
  await expect(dialog).not.toBeVisible();
});
