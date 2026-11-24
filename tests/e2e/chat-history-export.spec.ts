import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import en from '../../src/locales/en.json' with { type: 'json' };
import { expect, test, SIGNED_OUT } from './fixtures/test';
import { timelineImage, timelineItem } from './fixtures/timeline-items';

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
        timelineItem('export-one', 'Export this passage before the edit'),
        timelineItem('removed', 'Export this passage before withdrawal'),
        timelineItem('export-two', 'Do not include this message'),
      ],
    },
  ]);
  await page.getByRole('button', { name: en.common.searchMessages, exact: true }).click();
  await page.getByRole('button', { name: '查看及导出聊天记录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '聊天记录', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: '搜索聊天记录' }).fill('Export this passage');
  await expect(dialog.locator('.history-message')).toHaveCount(2);
  await expect(dialog.locator('.history-stat')).toContainText('已载入');
  await core.emitTimelineDiff(await core.subscription(), [
    {
      op: 'reset',
      values: [
        timelineItem('export-one', 'Export this passage after the edit'),
        {
          ...timelineItem('removed', ''),
          content: { kind: 'redacted', reason: null, redacted_by: '@alice:example.test' },
        },
      ],
    },
  ]);
  await expect(dialog.locator('.history-message')).toHaveCount(1);
  await expect(dialog.locator('.history-message')).toContainText('after the edit');
  for (const [label, extension] of [
    ['TXT (.txt)', 'txt'],
    ['Markdown (.md)', 'md'],
    ['HTML (.html)', 'html'],
  ] as const) {
    await dialog.getByRole('button', { name: '导出已载入记录 ▾', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: label, exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    const path = await download.path();
    const content = await readFile(path, 'utf8');
    expect(content).toContain('Export this passage after the edit');
    expect(content).not.toContain('Export this passage before');
    expect(content).not.toContain('Do not include this message');
  }
  await dialog.getByRole('button', { name: '关闭聊天记录' }).click();
  await expect(dialog).not.toBeVisible();
});

test('export from an older permalink labels the missing newer history in the download', async ({
  page,
  timeline,
  installRoomCore,
}) => {
  await installRoomCore('forward_history');
  await page.goto('/rooms/!room:example.test?event=%24general-4%3Aexample.test');
  await timeline.expectRevealed();
  await page.getByRole('button', { name: en.common.searchMessages, exact: true }).click();
  await page.getByRole('button', { name: '查看及导出聊天记录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '聊天记录', exact: true });
  await expect(dialog.locator('.history-stat')).toContainText('尚未读到最新的记录');
  await dialog.getByRole('button', { name: '导出已载入记录 ▾', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'TXT (.txt)', exact: true }).click();
  const path = await (await downloaded).path();
  const content = await readFile(path, 'utf8');
  expect(content).toContain('尚未读到最新的记录');
  expect(content).toContain('General message 4');
});

test('date query reads its own pages and applies message type to preview and download', async ({
  page,
  app,
  core,
  installRoomCore,
}, testInfo) => {
  await installRoomCore('ready');
  await app.openRoom('!room:example.test');
  const yesterday = await page.evaluate(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    return { start: start.getTime(), end: end.getTime() };
  });
  await page.evaluate(
    (history) => {
      window.__e2eHistoryPages = history;
      window.__e2eHistoryPageDelayMs = 500;
    },
    [
      {
        items: [{ ...timelineImage('dated-image'), timestamp: yesterday.end }],
        cursor: { from: 'older', stop_at: '$previous:example.test' },
      },
      {
        items: [
          {
            ...timelineItem('dated-link', 'Read https://example.test/dated'),
            timestamp: yesterday.start,
          },
        ],
        cursor: null,
      },
    ]
  );
  const before = await core.timelineCommands();
  await page.getByRole('button', { name: en.common.searchMessages, exact: true }).click();
  await page.getByRole('button', { name: '查看及导出聊天记录' }).click();
  const dialog = page.getByRole('dialog', { name: '聊天记录', exact: true });
  const dateControls = dialog.locator('.date-controls');
  const dateControlsHeight = () =>
    dateControls.evaluate((row) => row.getBoundingClientRect().height);
  const idleHeight = await dateControlsHeight();
  const yesterdayPreset = dialog.getByRole('button', { name: '昨天' });
  const todayPreset = dialog.getByRole('button', { name: '今天', exact: true });
  await expect(todayPreset).toHaveAttribute('aria-pressed', 'false');
  await expect(yesterdayPreset).toHaveAttribute('aria-pressed', 'false');
  await yesterdayPreset.hover();
  const hoveredPreset = await yesterdayPreset.evaluate(
    (button) => getComputedStyle(button).backgroundColor
  );
  await page.mouse.down();
  await expect(yesterdayPreset).not.toHaveCSS('background-color', hoveredPreset);
  await page.mouse.up();
  await expect(yesterdayPreset).toHaveAttribute('aria-pressed', 'true');
  await expect(todayPreset).toHaveAttribute('aria-pressed', 'false');
  expect(await core.commands()).not.toContain('timeline.history_page');

  // The same bounds can be inspected and adjusted in the minute-precision picker.
  const startPicker = dialog.getByRole('button', { name: /^开始时间：/ });
  const closedBorder = await startPicker.evaluate((button) => getComputedStyle(button).borderColor);
  await startPicker.click();
  await expect(startPicker).toHaveAttribute('aria-expanded', 'true');
  await expect(startPicker).not.toHaveCSS('border-color', closedBorder);
  await expect(dialog.getByLabel('小时')).toHaveValue('00');
  await expect(dialog.getByRole('button', { name: '确定', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('history-date-picker.png') });
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(startPicker).toHaveAttribute('aria-expanded', 'false');
  await expect(yesterdayPreset).toHaveAttribute('aria-pressed', 'true');

  const query = dialog.getByRole('button', { name: '查询', exact: true });
  await query.hover();
  const hoveredQuery = await query.evaluate((button) => getComputedStyle(button).backgroundColor);
  await page.mouse.down();
  await expect(query).not.toHaveCSS('background-color', hoveredQuery);
  await page.mouse.up();
  await expect(dialog.getByRole('button', { name: '停止读取', exact: true })).toBeVisible();
  await expect(dialog.locator('.history-stat')).toContainText('正在读取历史');
  expect(await dateControlsHeight()).toBe(idleHeight);
  await page.screenshot({ path: testInfo.outputPath('history-date-reading.png') });
  await expect(dialog.locator('.history-stat')).toContainText('查询完成 · 共 2 条');
  await expect(dialog.getByRole('button', { name: '导出 2 条 ▾' })).toBeEnabled();
  const msgType = dialog.getByRole('combobox', { name: '消息类型' });
  await msgType.selectOption('media');
  await dialog.getByRole('button', { name: '预览图片' }).click();
  await expect(page.getByRole('dialog', { name: en.viewer.title })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: '预览图片' })).toBeVisible();
  await expect(msgType).toHaveValue('media');
  await expect(dialog.getByText('Read https://example.test/dated')).toHaveCount(0);
  await msgType.selectOption('file');
  await expect(dialog.getByRole('button', { name: '导出 0 条 ▾' })).toBeDisabled();
  await msgType.selectOption('link');
  await expect(dialog.getByRole('button', { name: '预览图片' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('history-date-result.png') });
  const exportButton = dialog.getByRole('button', { name: '导出 1 条 ▾' });
  await exportButton.click();
  await expect(dialog.getByRole('button', { name: 'TXT (.txt)' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('history-export-menu.png') });
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'TXT (.txt)' }).click();
  const content = await readFile(await (await downloaded).path(), 'utf8');
  expect(content).toContain('Read https://example.test/dated');
  expect(content).not.toContain('History image');
  expect(await core.timelineCommands()).toEqual(before);
  expect(
    (await core.commands()).filter((command) => command === 'timeline.history_page')
  ).toHaveLength(2);

  const sender = dialog.getByRole('combobox', { name: '发送者' });
  await sender.selectOption('@alice:example.test');
  await todayPreset.click();
  await expect(todayPreset).toHaveAttribute('aria-pressed', 'true');
  await expect(yesterdayPreset).toHaveAttribute('aria-pressed', 'false');
  await expect(sender).toHaveValue('@alice:example.test');
  await expect(dialog.getByRole('button', { name: '导出 0 条 ▾' })).toBeDisabled();

  const buttonPositions = () =>
    dateControls
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(new Set(await buttonPositions()).size).toBe(1);
  await dialog.evaluate((element) => {
    element.style.width = '29rem';
  });
  expect(new Set(await buttonPositions()).size).toBeGreaterThan(1);
  expect(await dateControls.evaluate((row) => row.scrollWidth)).toBe(
    await dateControls.evaluate((row) => row.clientWidth)
  );
  expect(
    await dateControls
      .locator('.date-value')
      .evaluateAll((values) => values.every((value) => value.scrollWidth === value.clientWidth))
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('history-date-controls-wrapped.png') });
  const endPicker = dialog.getByRole('button', { name: /^结束时间：/ });
  await endPicker.click();
  await expect(endPicker).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByLabel('分钟')).toHaveValue('59');
  await dialog.getByLabel('分钟').selectOption('58');
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(todayPreset).toHaveAttribute('aria-pressed', 'false');
  await expect(endPicker).toHaveAttribute('aria-expanded', 'false');
  await endPicker.click();
  await dialog.getByLabel('分钟').selectOption('59');
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(todayPreset).toHaveAttribute('aria-pressed', 'true');
});

test.describe('phone room search', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('opens history in the search header and Back preserves the search', async ({
    page,
    app,
    core,
    installRoomCore,
  }, testInfo) => {
    await installRoomCore('ready');
    await app.openRoom('!room:example.test');
    await core.emitTimelineDiff(await core.subscription(), [
      { op: 'reset', values: [timelineItem('mobile-cached', 'Cached room message')] },
    ]);
    await expect(page.getByText('Cached room message', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: en.common.searchMessages, exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=/);
    const search = page.getByRole('combobox', { name: en.common.searchMessages });
    await search.fill('Keep me');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'))
      .toBe('in:!room:example.test Keep me');
    const titlebar = page.locator('header.mobile-back-bar');
    await expect(titlebar.getByRole('heading', { name: en.common.searchMessages })).toBeVisible();
    const history = titlebar.getByRole('button', { name: '查看及导出聊天记录' });
    await expect(history).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('phone-room-search-header.png') });
    await history.click();
    const dialog = page.getByRole('dialog', { name: '聊天记录', exact: true });
    await expect(dialog.getByText('General', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Cached room message')).toBeVisible();
    expect(await core.commands()).not.toContain('timeline.history_page');
    const summary = dialog.getByRole('button', { name: /^日期与筛选：/ });
    const summaryText = summary.locator('span').first();
    const presets = dialog.getByRole('group', { name: '快捷日期' });
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(summaryText).toHaveText('不限日期');
    await expect(presets.getByRole('button')).toHaveText(['今天', '昨天', '最近 7 天']);
    await expect(dialog.getByRole('button', { name: /^开始时间：/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('phone-history-filters-collapsed.png') });
    await summary.click();
    await expect(summary).toHaveAttribute('aria-expanded', 'true');

    const dateControls = dialog.locator('.date-controls');
    const actionBounds = () => dialog.locator('.query-action').boundingBox();
    const dateButtons = dialog.locator('.compact-date-actions, .date-controls').getByRole('button');
    const rows = await dateButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().top)
    );
    expect(rows).toEqual([rows[0], rows[0], rows[0], rows[0], rows[4], rows[4]]);
    expect(rows[4]).toBeGreaterThan(rows[0]);
    const start = dialog.getByRole('button', { name: /^开始时间：/ });
    const end = dialog.getByRole('button', { name: /^结束时间：/ });
    expect((await start.boundingBox())?.width).toBe((await end.boundingBox())?.width);
    await expect(dialog.getByRole('button', { name: '读取全部历史', exact: true })).toBeVisible();
    const idleBounds = await actionBounds();
    await page.screenshot({ path: testInfo.outputPath('phone-history-two-rows-idle.png') });
    const keyword = dialog.getByRole('searchbox', { name: '搜索聊天记录' });
    const sender = dialog.getByRole('combobox', { name: '发送者' });
    const type = dialog.getByRole('combobox', { name: '消息类型' });
    for (const [trigger, label, option] of [
      [sender, '发送者', 'Alice'],
      [type, '消息类型', '图片与视频'],
    ] as const) {
      await trigger.tap();
      const list = dialog.getByRole('listbox', { name: label });
      await expect(list).toBeInViewport({ ratio: 1 });
      const [anchor, popup, frame] = await Promise.all([
        trigger.boundingBox(),
        list.boundingBox(),
        dialog.boundingBox(),
      ]);
      assert(anchor && popup && frame);
      expect(popup.x).toBeCloseTo(anchor.x, 0);
      expect(popup.width).toBeCloseTo(anchor.width, 0);
      expect(popup.y - (anchor.y + anchor.height)).toBeCloseTo(4, 0);
      expect(popup.x).toBeGreaterThan(frame.x);
      expect(popup.x + popup.width).toBeLessThan(frame.x + frame.width);
      expect(popup.y + popup.height).toBeLessThan(frame.y + frame.height);
      await list.getByRole('option', { name: option, exact: true }).tap();
      await expect(trigger).toHaveText(option);
      await expect(list).not.toBeVisible();
    }
    const types = dialog.getByRole('listbox', { name: '消息类型' });
    await type.tap();
    await expect(types).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('phone-history-type-menu.png') });
    await page.keyboard.press('Escape');
    await expect(types).not.toBeVisible();
    await expect(dialog).toBeVisible();

    await page.setViewportSize({ width: 390, height: 540 });
    await type.tap();
    await expect(types).toBeInViewport({ ratio: 1 });
    await expect(types).toHaveAttribute('data-side', 'top');
    await page.screenshot({ path: testInfo.outputPath('phone-history-type-menu-short.png') });
    await page.goBack();
    await expect(type).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await keyword.fill('History');

    await page.evaluate(
      (image) => {
        const now = new Date();
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
        window.__e2eHistoryPages = [
          { cursor: null, items: [{ ...image, timestamp: date.getTime() }] },
        ];
        window.__e2eHistoryPageDelayMs = 750;
      },
      timelineImage('phone-history-image', 'mxc://example.test/spoiler-preview')
    );
    const today = presets.getByRole('button', { name: '今天', exact: true });
    const yesterday = presets.getByRole('button', { name: '昨天', exact: true });
    const recent = presets.getByRole('button', { name: '最近 7 天', exact: true });
    await recent.click();
    await expect(summaryText).toHaveText(/^\d{4}-\d\d-\d\d 00:00 – \d{4}-\d\d-\d\d 23:59$/);
    await yesterday.click();
    await expect(summaryText).toHaveText(/^\d{4}-\d\d-\d\d 00:00 – 23:59$/);
    const clear = dialog.getByRole('button', { name: '清除', exact: true });
    await start.click();
    await clear.click();
    await expect(summaryText).toHaveText(/^截至 \d{4}-\d\d-\d\d 23:59$/);
    await yesterday.click();
    await end.click();
    await clear.click();
    await expect(summaryText).toHaveText(/^从 \d{4}-\d\d-\d\d 00:00 起$/);
    await yesterday.click();

    await summary.click();
    await expect(dialog.locator('.history-stat')).toHaveText('查询后显示所选时段的记录');
    expect(await core.commands()).not.toContain('timeline.history_page');
    await summary.click();
    await expect(keyword).toHaveValue('History');
    await expect(sender).toHaveText('@alice:example.test');
    await expect(type).toHaveText('图片与视频');
    expect(await actionBounds()).toEqual(idleBounds);
    expect(
      await dateControls
        .locator('.date-value')
        .evaluateAll((values) => values.every((value) => value.scrollWidth === value.clientWidth))
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('phone-history-two-rows-selected.png') });

    const confirm = dialog.getByRole('button', { name: '确定', exact: true });
    await start.click();
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByLabel('小时')).toHaveValue('00');
    await confirm.click();
    await end.click();
    await expect(confirm).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('phone-history-date-picker.png') });
    await confirm.click();
    await dialog.getByRole('button', { name: '查询', exact: true }).click();
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(summary).toBeFocused();
    await expect(dialog.getByRole('button', { name: '停止读取', exact: true })).toBeVisible();
    await expect(dialog.locator('.history-stat')).toContainText('正在读取历史');
    await summary.click();
    expect(await actionBounds()).toEqual(idleBounds);
    await keyword.fill('History image');
    await expect(dialog.locator('.history-stat')).toContainText('正在读取历史');
    await expect(dialog.locator('.history-stat')).toHaveText('查询完成 · 共 1 条');
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
    await summary.click();
    await page.screenshot({ path: testInfo.outputPath('phone-history-date-summary.png') });
    const preview = dialog.getByRole('button', { name: '预览图片', exact: true });
    await preview.click();
    const viewer = page.getByRole('dialog', { name: en.viewer.title });
    await expect(viewer.getByRole('img', { name: 'History image' })).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('phone-history-media.png') });
    await page.goBack();
    await expect(preview).toBeVisible();
    expect(
      (await page.evaluate(() => window.__e2eCalls)).filter(
        (call) => call.method === 'timeline.history_page'
      )
    ).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ room_id: '!room:example.test' }),
      }),
    ]);

    await dialog.getByRole('button', { name: '导出 1 条 ▾', exact: true }).click();
    const menu = dialog.getByRole('group', { name: '导出格式' });
    await expect(menu).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('phone-history-export-menu.png') });
    const downloaded = page.waitForEvent('download');
    await menu.getByRole('button', { name: 'TXT (.txt)', exact: true }).click();
    const content = await readFile(await (await downloaded).path(), 'utf8');
    expect(content).toContain('History image');

    const quickBounds = await page.evaluate((image) => {
      const now = new Date();
      const dayAt = (offset: number, hour: number, min = 0, sec = 0, ms = 0) =>
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + offset,
          hour,
          min,
          sec,
          ms
        ).getTime();
      window.__e2eHistoryPages = [
        { cursor: null, items: [] },
        { cursor: null, items: [] },
        { cursor: null, items: [{ ...image, timestamp: dayAt(-3, 12) }] },
      ];
      return [
        { after: dayAt(0, 0), before: dayAt(0, 23, 59, 59, 999) },
        { after: dayAt(-1, 0), before: dayAt(-1, 23, 59, 59, 999) },
        { after: dayAt(-6, 0), before: dayAt(0, 23, 59, 59, 999) },
      ];
    }, timelineImage('phone-quick-history-image'));
    const status = dialog.locator('.history-stat');
    await today.tap();
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(today).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toHaveText('查询完成 · 共 0 条');
    await expect(preview).not.toBeVisible();
    await yesterday.tap();
    await expect(dialog.getByRole('button', { name: '停止读取', exact: true })).toBeVisible();
    await recent.tap();
    await expect(recent).toHaveAttribute('aria-pressed', 'true');
    await expect(yesterday).toHaveAttribute('aria-pressed', 'false');
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(preview).toBeVisible();
    await expect(summaryText).toHaveText(/^\d{4}-\d\d-\d\d 00:00 – \d{4}-\d\d-\d\d 23:59$/);
    await page.screenshot({ path: testInfo.outputPath('phone-history-quick-result.png') });
    expect(
      (await page.evaluate(() => window.__e2eCalls))
        .filter((call) => call.method === 'timeline.history_page')
        .slice(1)
        .map((call) => call.params)
    ).toEqual(
      quickBounds.map((range) => ({ room_id: '!room:example.test', ...range, cursor: null }))
    );
    await summary.tap();
    await expect(presets).toHaveCount(1);
    await expect(keyword).toHaveValue('History image');
    await expect(sender).toHaveText('Alice');
    await expect(type).toHaveText('图片与视频');
    await page.screenshot({ path: testInfo.outputPath('phone-history-quick-expanded.png') });

    await page.goBack();
    await expect(dialog).not.toBeVisible();
    await expect(search).toHaveValue('Keep me');
    await expect(history).toBeVisible();
    await page.getByRole('button', { name: 'Remove in:General' }).click();
    await expect(history).toHaveCount(0);
    await expect(search).toHaveValue('Keep me');
    await page.goBack();
    await expect(page).toHaveURL(/\/rooms\//);
  });
});
