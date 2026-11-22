// @vitest-environment happy-dom

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { fromStore, writable } from 'svelte/store';
import { afterEach, expect, test, vi } from 'vitest';
import type { TimelineItemView } from '#src/generated/protocol';

import RoomHistoryExportTools from './RoomHistoryExportTools.svelte';
import {
  HISTORY_EXPORT_CONTEXT,
  type RoomHistoryExportContext,
} from './room-history-export-context';
import {
  createHistoryHtml,
  createHistoryMarkdown,
  createHistoryText,
  extractSafeLinks,
  filterHistory,
  HistoryExportCache,
  normalizeHistoryItem,
  parseHistoryBoundary,
  saveHistoryFile,
  saveHistoryText,
  type ExportedMessage,
  type HistoryExportFormat,
  type HistoryFilter,
} from './room-history-export';
import { timelineItem } from './timeline/test-items.js';

const entry: ExportedMessage = {
  eventId: '$message:example.org',
  timestamp: new Date(2026, 10, 14, 12, 30).getTime(),
  senderId: '@alice:example.org',
  senderName: 'Alice',
  body: 'Hello https://example.org/',
  category: 'message',
  hasLink: true,
  links: ['https://example.org/'],
};
const filters: HistoryFilter = {
  query: '',
  senderId: '',
  after: '',
  before: '',
  category: 'all',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('date-only boundaries include the complete local day', () => {
  expect(parseHistoryBoundary('2026-11-14', false)).toBe(new Date(2026, 10, 14).getTime());
  expect(parseHistoryBoundary('2026-11-14', true)).toBe(
    new Date(2026, 10, 14, 23, 59, 59, 999).getTime()
  );
});

test('explicit midnight and minute boundaries retain zero-valued fields', () => {
  expect(parseHistoryBoundary('2026-11-14T00:00', true)).toBe(
    new Date(2026, 10, 14, 0, 0, 59, 999).getTime()
  );
  expect(parseHistoryBoundary('2026-11-14T12:30', false)).toBe(entry.timestamp);
  expect(parseHistoryBoundary('2026-11-14T12:30', true)).toBe(
    new Date(2026, 10, 14, 12, 30, 59, 999).getTime()
  );
});

test.each(['', '2026-02-30', '2026-13-01', '2026-11-14T24:00', '2026-11-14T12:60'])(
  'rejects invalid date boundary %j',
  (value) => {
    expect(parseHistoryBoundary(value, false)).toBeNull();
  }
);

test('date filtering includes both ends of the selected minute', () => {
  const end = {
    ...entry,
    eventId: '$end',
    timestamp: new Date(2026, 10, 14, 12, 30, 59, 999).getTime(),
  };
  const next = { ...entry, eventId: '$next', timestamp: new Date(2026, 10, 14, 12, 31).getTime() };
  expect(
    filterHistory([entry, end, next], {
      ...filters,
      after: '2026-11-14T12:30',
      before: '2026-11-14T12:30',
    })
  ).toEqual([entry, end]);
});

test('link extraction stops at controls, trims punctuation and rejects private media URLs', () => {
  expect(
    extractSafeLinks(
      'https://example.org/a\u0001hidden mxc://server/media javascript:alert(1) https://example.org/a。'
    )
  ).toEqual(['https://example.org/a']);
});

test('normalization supplies links for every exported message', () => {
  const message = normalizeHistoryItem({
    event_id: '$a',
    sender: '@alice:example.org',
    content: { body: entry.body },
  });
  expect(message?.links).toEqual(entry.links);
  expect(message?.hasLink).toBe(true);
});

test('the export cache reconciles edits and redactions without losing older pages', () => {
  const cache = new HistoryExportCache();
  const names = new Map<string, string>();
  const older = timelineItem('older', 'Earlier page', { timestamp: 1 });
  const original = timelineItem('edited', 'Original https://example.org/old', { timestamp: 2 });
  const removed = timelineItem('removed', 'Withdrawn message', { timestamp: 3 });
  const initial = cache.collect([original, removed, older], names);
  expect(initial.map((item) => item.eventId)).toEqual(['$older', '$edited', '$removed']);
  expect(cache.collect([original, removed], names)).toBe(initial);

  const body = 'Edited https://example.org/new';
  const edited = timelineItem('replacement-row', body, { eventId: '$edited', timestamp: 2 });
  const redacted = {
    ...removed,
    content: { kind: 'redacted', reason: null, redacted_by: null } as const,
  };
  const current = cache.collect([edited, redacted], names);
  expect(current.map((item) => item.body)).toEqual(['Earlier page', body]);
  expect(cache.collect([removed], names)).toBe(current);

  const matching = filterHistory(current, { ...filters, category: 'link' });
  expect(matching.map((item) => item.links)).toEqual([['https://example.org/new']]);
});

test('replacing a message with an empty body removes its previous text and links', () => {
  const cache = new HistoryExportCache();
  const names = new Map<string, string>();
  cache.collect([timelineItem('message', entry.body)], names);

  const updated = cache.collect([timelineItem('message', '')], names);
  expect(updated.map((item) => item.body)).toEqual(['']);
  expect(filterHistory(updated, { ...filters, category: 'link' })).toEqual([]);
});

test('the preview and all downloads use the same reconciled messages', async () => {
  const older = timelineItem('older', 'Earlier page');
  const originalBody = 'Original https://example.org/old';
  const original = timelineItem('edited', originalBody);
  const removed = timelineItem('removed', 'Withdrawn message');
  const pages = writable<readonly TimelineItemView[]>([older, original, removed]);
  const timeline = fromStore(pages);
  const source: RoomHistoryExportContext = {
    roomId: () => '!room:example.org',
    roomName: () => 'Room',
    timelineItems: () => timeline.current,
    members: () => [],
    loadOlder: () => Promise.resolve(true),
    openMedia: () => {},
    jumpToMessage: () => {},
  };
  const download = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:history');
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(RoomHistoryExportTools, { context: new Map([[HISTORY_EXPORT_CONTEXT, source]]) });
  await fireEvent.click(screen.getByRole('button', { name: '查看及导出聊天记录' }));
  const dialog = within(screen.getByRole('dialog', { name: '聊天记录' }));
  await dialog.findByText('已达时间线边界', { exact: false });
  expect(dialog.getByText(originalBody)).toBeVisible();

  const body = 'Edited https://example.org/new';
  pages.set([
    timelineItem('edited', body),
    { ...removed, content: { kind: 'redacted', reason: null, redacted_by: null } },
  ]);
  expect(await dialog.findByText(body)).toBeVisible();
  expect(dialog.getByText('Earlier page')).toBeVisible();
  expect(dialog.queryByText('Withdrawn message')).toBeNull();
  expect(dialog.queryByText('https://example.org/old')).toBeNull();
  expect(dialog.getByRole('link', { name: /https:\/\/example\.org\/new/ })).toBeVisible();

  for (const [name, mime] of [
    ['TXT (.txt)', 'text/plain'],
    ['Markdown (.md)', 'text/markdown'],
    ['HTML (.html)', 'text/html'],
  ]) {
    await fireEvent.click(dialog.getByRole('button', { name: '导出聊天记录 ▾' }));
    await fireEvent.click(dialog.getByRole('button', { name }));
    const blob = download.mock.lastCall?.[0];
    if (!(blob instanceof Blob)) throw new Error(`${name} did not generate a file`);
    expect(blob.type).toBe(`${mime};charset=utf-8`);
    const text = await blob.text();
    expect(text).toContain('Earlier page');
    expect(text).toContain(body);
    expect(text).not.toContain('https://example.org/old');
    expect(text).not.toContain('Withdrawn message');
  }
});

test('TXT retains sender identity, body and media references', () => {
  const text = createHistoryText(
    'Room',
    '!room:example.org',
    [{ ...entry, category: 'image' }],
    'Loaded'
  );
  expect(text).toContain(entry.senderId);
  expect(text).toContain(entry.body);
  expect(text).toContain('https://matrix.to/#/!room%3Aexample.org/%24message%3Aexample.org');
});

test('Markdown escapes headings and retains links', () => {
  const markdown = createHistoryMarkdown('Room [one]', '!room:example.org', [entry], 'Loaded');
  expect(markdown).toContain('Room \\[one\\]');
  expect(markdown).toContain(entry.body);
  expect(markdown).toContain('<https://example.org/>');
});

test('HTML escapes chat text and preserves safe links', () => {
  const html = createHistoryHtml(
    '<Room>',
    '!room:example.org',
    [{ ...entry, body: '<script>alert(1)</script>' }],
    'Loaded'
  );
  expect(html).toContain('&lt;Room&gt;');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('href="https://example.org/"');
});

test.each<HistoryExportFormat>(['txt', 'md', 'html'])(
  'downloads %s with a sanitized filename and delayed URL cleanup',
  (format) => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:history');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    saveHistoryFile('Room\\/:*?"<>|\u0001', format, 'Exported text');
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(
      new RegExp(`^Room_+-聊天记录-\\d{4}-\\d{2}-\\d{2}\\.${format}$`)
    );
    expect(anchor.isConnected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revoke).toHaveBeenCalledWith('blob:history');
  }
);

test('the original TXT download entry point retains filename sanitization and cleanup', () => {
  vi.useFakeTimers();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:history');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  saveHistoryText('Room/\u0001', 'Exported text');
  expect((click.mock.instances[0] as HTMLAnchorElement).download).toMatch(
    /^Room__-聊天记录-.*\.txt$/
  );
  vi.advanceTimersByTime(30_000);
  expect(revoke).toHaveBeenCalledWith('blob:history');
});
