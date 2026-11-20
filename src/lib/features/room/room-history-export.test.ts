// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';
import {
  createHistoryHtml,
  createHistoryMarkdown,
  createHistoryText,
  extractSafeLinks,
  filterHistory,
  normalizeHistoryItem,
  parseHistoryBoundary,
  saveHistoryFile,
  saveHistoryText,
  type ExportedMessage,
  type HistoryExportFormat,
  type HistoryFilter,
} from './room-history-export';

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
