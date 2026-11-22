// @vitest-environment happy-dom

import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, assert, expect, test, vi } from 'vitest';

import type { CoreClient } from '#lib/core/client.svelte.js';
import { RoomTimeline } from '#lib/rooms/timeline.svelte.js';

import RoomHistoryExportTools from './RoomHistoryExportTools.svelte';
import {
  HISTORY_EXPORT_CONTEXT,
  type RoomHistoryExportContext,
} from './room-history-export-context.js';
import { timelineItem } from './timeline/test-items.js';

afterEach(() => {
  vi.restoreAllMocks();
});

test.each(['TXT (.txt)', 'Markdown (.md)', 'HTML (.html)'])(
  '%s reports the missing newer history after backfill reaches the start',
  async (format) => {
    const timeline = new RoomTimeline({} as CoreClient);
    timeline.mode = { kind: 'focused', eventId: '$old' };
    timeline.items = [timelineItem('old', 'Older message')];
    const page = Promise.withResolvers<boolean>();
    const context: RoomHistoryExportContext = {
      roomId: () => '!room:example.org',
      roomName: () => 'Room',
      timelineItems: () => timeline.items,
      reachesLatest: () => timeline.reachesLatest,
      members: () => [],
      loadOlder: () => page.promise,
      openMedia: () => {},
      jumpToMessage: () => {},
    };
    const download = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:history');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const panel = render(RoomHistoryExportTools, {
      context: new Map([[HISTORY_EXPORT_CONTEXT, context]]),
    });
    await fireEvent.click(panel.getByRole('button', { name: '查看及导出聊天记录' }));
    const dialog = panel.getByRole('dialog');
    const exportButton = within(dialog).getByRole('button', { name: /导出聊天记录/ });
    expect(dialog).toHaveTextContent('较早的记录尚未读完；尚未读到最新的记录');
    await fireEvent.click(exportButton);
    await fireEvent.click(panel.getByRole('button', { name: format }));
    expect(download).not.toHaveBeenCalled();

    page.resolve(true);
    await waitFor(() => {
      expect(download).toHaveBeenCalledTimes(1);
    });
    expect(dialog).toHaveTextContent('尚未读到最新的记录');
    expect(dialog).not.toHaveTextContent('较早的记录尚未读完');
    expect(dialog).toHaveTextContent('（部分历史）');
    const partialFile = download.mock.calls[0]?.[0];
    assert(partialFile instanceof Blob);
    expect(await partialFile.text()).toContain(
      '仅含已读取且符合筛选条件的记录；尚未读到最新的记录'
    );
    expect(timeline.mode.kind).toBe('focused');

    timeline.items = [...timeline.items, timelineItem('new', 'Newer message')];
    timeline.forwardPagination = 'end';
    await tick();
    expect(dialog).toHaveTextContent('已读到最早和最新可读取的记录');
    expect(dialog).not.toHaveTextContent('尚未读到最新的记录');
    await fireEvent.click(exportButton);
    await fireEvent.click(panel.getByRole('button', { name: format }));
    const completeFile = download.mock.calls[1]?.[0];
    assert(completeFile instanceof Blob);
    const completeText = await completeFile.text();
    expect(completeText).toContain('已读取历史（按当前筛选条件）');
    expect(completeText).toContain('Newer message');
    expect(dialog).not.toHaveTextContent('（部分历史）');
  }
);
