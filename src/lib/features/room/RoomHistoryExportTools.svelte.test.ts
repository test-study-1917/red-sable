// @vitest-environment happy-dom

import { act, fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, assert, expect, test, vi } from 'vitest';

import RoomHistoryExportTools from './RoomHistoryExportTools.svelte';
import {
  HISTORY_EXPORT_CONTEXT,
  type RoomHistoryExportContext,
} from './room-history-export-context.js';
import { timelineItem } from './timeline/test-items.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function openRoomHistory(readPage: RoomHistoryExportContext['readPage']) {
  const context: RoomHistoryExportContext = {
    roomId: () => '!room:example.org',
    roomName: () => 'Room',
    timelineItems: () => [timelineItem('current', 'Current message')],
    reachesStart: () => false,
    reachesLatest: () => false,
    members: () => [],
    readPage,
    jumpToMessage: () => {},
  };
  const download = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:history');
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const panel = render(RoomHistoryExportTools, {
    context: new Map([[HISTORY_EXPORT_CONTEXT, context]]),
  });
  return { panel, download };
}

test('opening history allows immediate export of the current window without fetching', async () => {
  const readPage = vi.fn<RoomHistoryExportContext['readPage']>();
  const { panel, download } = openRoomHistory(readPage);
  await fireEvent.click(panel.getByRole('button', { name: '查看及导出聊天记录' }));
  const dialog = within(panel.getByRole('dialog'));
  await fireEvent.click(dialog.getByRole('button', { name: '导出已载入记录 ▾' }));
  await fireEvent.click(dialog.getByRole('button', { name: 'TXT (.txt)' }));

  expect(readPage).not.toHaveBeenCalled();
  const file = download.mock.calls[0]?.[0];
  assert(file instanceof Blob);
  expect(await file.text()).toContain('较早的记录尚未读完；尚未读到最新的记录');
  expect(await file.text()).toContain('Current message');

  readPage.mockResolvedValue({
    cursor: null,
    items: [timelineItem('all', 'All history')],
    has_undecryptable_events: false,
  });
  await fireEvent.click(dialog.getByRole('button', { name: '读取全部历史' }));
  await dialog.findByText('All history');
  expect(readPage).toHaveBeenCalledExactlyOnceWith({
    room_id: '!room:example.org',
    after: null,
    before: null,
    cursor: null,
  });
});

test('the selected date range governs the same preview and export', async () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
  const next = Promise.withResolvers<Awaited<ReturnType<RoomHistoryExportContext['readPage']>>>();
  const readPage = vi
    .fn<RoomHistoryExportContext['readPage']>()
    .mockResolvedValueOnce({
      items: [timelineItem('upper', 'Last message', { timestamp: end.getTime() })],
      cursor: { from: 'older', stop_at: '$stop' },
      has_undecryptable_events: true,
    })
    .mockReturnValueOnce(next.promise);
  const { panel, download } = openRoomHistory(readPage);
  await fireEvent.click(panel.getByRole('button', { name: '查看及导出聊天记录' }));
  const dialog = within(panel.getByRole('dialog'));
  await fireEvent.click(dialog.getByRole('button', { name: '昨天' }));
  expect(readPage).not.toHaveBeenCalled();
  expect(dialog.queryByText('Current message')).toBeNull();
  await fireEvent.click(dialog.getByRole('button', { name: '查询' }));
  expect(readPage).toHaveBeenNthCalledWith(1, {
    room_id: '!room:example.org',
    after: start.getTime(),
    before: end.getTime(),
    cursor: null,
  });
  expect(dialog.getByRole('button', { name: /导出/ })).toBeDisabled();
  next.resolve({
    items: [
      timelineItem('lower', 'First message https://example.org/first', {
        timestamp: start.getTime(),
      }),
    ],
    cursor: null,
    has_undecryptable_events: false,
  });
  await dialog.findByText('First message https://example.org/first');
  expect(dialog.getByText('Last message')).toBeVisible();
  expect(dialog.getByRole('button', { name: '导出 2 条 ▾' })).toBeEnabled();
  expect(dialog.getByText(/查询完成 · 可读 2 条 · 有加密事件无法解密/)).toBeVisible();

  for (const format of ['TXT (.txt)', 'Markdown (.md)', 'HTML (.html)']) {
    await fireEvent.click(dialog.getByRole('button', { name: '导出 2 条 ▾' }));
    await fireEvent.click(dialog.getByRole('button', { name: format }));
    const file = download.mock.lastCall?.[0];
    assert(file instanceof Blob);
    const text = await file.text();
    expect(text).toContain('First message https://example.org/first');
    expect(text).toContain('Last message');
    expect(text).toContain('00:00 至');
    expect(text).toContain('有加密事件无法解密，未纳入结果');
    expect(text).not.toContain('未读完');
  }
  expect(readPage).toHaveBeenCalledTimes(2);
});

test('cancelled and stale results cannot complete or expand a partial export', async () => {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const next = Promise.withResolvers<Awaited<ReturnType<RoomHistoryExportContext['readPage']>>>();
  const readPage = vi
    .fn<RoomHistoryExportContext['readPage']>()
    .mockResolvedValueOnce({
      items: [timelineItem('partial', 'Partial result', { timestamp: yesterday.getTime() })],
      cursor: { from: 'older', stop_at: '$stop' },
      has_undecryptable_events: true,
    })
    .mockReturnValueOnce(next.promise)
    .mockResolvedValueOnce({
      items: [timelineItem('new', 'New result', { timestamp: Date.now() })],
      cursor: null,
      has_undecryptable_events: false,
    });
  const { panel, download } = openRoomHistory(readPage);
  await fireEvent.click(panel.getByRole('button', { name: '查看及导出聊天记录' }));
  const dialog = within(panel.getByRole('dialog'));
  await fireEvent.click(dialog.getByRole('button', { name: '昨天' }));
  await fireEvent.click(dialog.getByRole('button', { name: '查询' }));
  await dialog.findByText('Partial result');
  await fireEvent.click(dialog.getByRole('button', { name: '停止读取' }));
  await fireEvent.click(dialog.getByRole('button', { name: '仅导出已读取结果 ▾' }));
  await fireEvent.click(dialog.getByRole('button', { name: 'TXT (.txt)' }));
  const file = download.mock.calls[0]?.[0];
  assert(file instanceof Blob);
  expect(await file.text()).toContain('所选时段未读完');
  expect(await file.text()).toContain('有加密事件无法解密，未纳入结果');

  await fireEvent.click(dialog.getByRole('button', { name: '今天' }));
  expect(dialog.queryByText('Partial result')).toBeNull();
  expect(dialog.getByText('查询后显示所选时段的记录')).toBeVisible();
  await fireEvent.click(dialog.getByRole('button', { name: '查询' }));
  await dialog.findByText('New result');
  await act(() => {
    next.resolve({
      items: [timelineItem('stale', 'Stale result', { timestamp: Date.now() })],
      cursor: null,
      has_undecryptable_events: true,
    });
  });
  expect(dialog.getByText('查询完成 · 共 1 条')).toBeVisible();
  expect(dialog.queryByText('Stale result')).toBeNull();
  expect(dialog.queryByText(/无法解密/)).toBeNull();
});
