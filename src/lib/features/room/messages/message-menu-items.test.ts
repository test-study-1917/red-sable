import { afterEach, expect, test } from 'vitest';

import { setPreference } from '#lib/settings/preferences.svelte.js';
import { messageMenuRows } from './message-menu-items.js';

afterEach(() => {
  setPreference('showExtraMessageMenuItems', false);
});

test('reply offers one row, not a second that claims to open a thread', () => {
  const rows = messageMenuRows({ onReply: () => {} });

  expect(rows.map((row) => row.key)).toEqual(['reply']);
});

test('bookmark reads back the state it was given', () => {
  const bookmarked = messageMenuRows({ onBookmark: () => {}, bookmarked: true });
  const plain = messageMenuRows({ onBookmark: () => {}, bookmarked: false });

  expect(bookmarked.find((row) => row.key === 'bookmark')?.label).toBe(
    'timeline.unbookmarkMessage'
  );
  expect(plain.find((row) => row.key === 'bookmark')?.label).toBe('timeline.bookmarkMessage');
});

test('message permalinks are labelled separately from body links', () => {
  const rows = messageMenuRows({ onCopyLink: () => {} });

  expect(rows.find((row) => row.key === 'link')?.label).toBe('timeline.copyMessageLink');
});

test('a link under the cursor adds a row beside the message permalink', () => {
  const rows = messageMenuRows({
    onCopyHref: () => {},
    onShareHref: () => {},
    onCopyLink: () => {},
  });

  expect(rows.map((row) => [row.key, row.label])).toEqual([
    ['href', 'timeline.copyLink'],
    ['share-href', 'timeline.shareLink'],
    ['link', 'timeline.copyMessageLink'],
  ]);
});

test('read receipts and version history stay visible when source is hidden', () => {
  const actions = {
    onReadReceipts: () => {},
    onEditHistory: () => {},
    onViewSource: () => {},
  };
  expect(messageMenuRows(actions).map((row) => row.key)).toEqual(['receipts', 'edit-history']);

  setPreference('showExtraMessageMenuItems', true);
  const rows = messageMenuRows(actions);
  expect(rows.map((row) => row.key)).toEqual(['receipts', 'edit-history', 'source']);
  expect(rows[1].label).toBe('timeline.editHistory');
});

test('an action with no handler contributes no row', () => {
  expect(messageMenuRows({})).toEqual([]);
});

test('mark unread is offered only when the room can carry it', () => {
  const rows = messageMenuRows({ onMarkUnread: () => {} });

  expect(rows.map((row) => row.key)).toEqual(['mark-unread']);
  expect(rows[0].label).toBe('timeline.markUnread');
  expect(messageMenuRows({ onReply: () => {} }).some((row) => row.key === 'mark-unread')).toBe(
    false
  );
});

test('the gif row reads back whether the gif is already saved', () => {
  const saved = messageMenuRows({ onFavoriteGif: () => {}, gifFavorited: true });
  const unsaved = messageMenuRows({ onFavoriteGif: () => {} });

  expect(saved[0]?.label).toBe('composer.gifUnfavorite');
  expect(unsaved[0]?.label).toBe('composer.gifFavorite');
});

test('both selection quote actions appear alongside the ordinary reply', () => {
  const markdown = () => {};
  const reply = () => {};
  const rows = messageMenuRows({
    onQuoteMarkdown: markdown,
    onQuoteReply: reply,
    onReply: () => {},
  });
  expect(rows.map(({ key }) => key)).toEqual(['quote-markdown', 'quote-reply', 'reply']);
  expect(rows[0].run).toBe(markdown);
  expect(rows[1].run).toBe(reply);
});

test('the Meowlnir ban keeps its separator when report is hidden', () => {
  const actions = { onReport: () => {}, onMeowlnirBan: () => {} };
  expect(messageMenuRows(actions)).toMatchObject([
    { key: 'meowlnir-ban', destructive: true, separated: true },
  ]);

  setPreference('showExtraMessageMenuItems', true);
  expect(messageMenuRows(actions)).toMatchObject([
    { key: 'report', separated: true },
    { key: 'meowlnir-ban', destructive: true, separated: false },
  ]);
});

test('select row appears separated before mark unread when provided', () => {
  const withUnread = messageMenuRows({ onSelect: () => {}, onMarkUnread: () => {} });
  expect(withUnread.map((row) => [row.key, row.label, row.separated ?? false])).toEqual([
    ['select', 'timeline.selectMessage', true],
    ['mark-unread', 'timeline.markUnread', false],
  ]);

  const selectOnly = messageMenuRows({ onSelect: () => {} });
  expect(selectOnly.map((row) => [row.key, row.separated ?? false])).toEqual([['select', true]]);
});
