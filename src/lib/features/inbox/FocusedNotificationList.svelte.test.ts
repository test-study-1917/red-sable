// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('#lib/core/context.js');
vi.mock('#lib/rooms/room-list.svelte.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/rooms/room-list.svelte.js')>()),
  useRoomList: () => roomList,
}));

import { core } from '#lib/core/__mocks__/context.js';
import FocusedNotificationList from './FocusedNotificationList.svelte';
import type { InboxItemView, RoomListItemView } from '#src/generated/protocol';

const roomList = vi.hoisted(() => ({
  rooms: [] as RoomListItemView[],
  badgeUnreadFor: (room: RoomListItemView) => room.counts,
  labelFor: () => 'Room',
  byId: () => undefined,
}));

beforeEach(() => {
  vi.clearAllMocks();
  roomList.rooms = [];
  core.session = { account_id: 'account' };
  core.rpc.notifications.backfillInbox.mockResolvedValue({ recorded: 0, has_more: false });
  core.subscribeEvents.mockReturnValue(() => {});
});

function notification(kind: string, read = false): InboxItemView {
  return {
    room_id: '!room:example.org',
    event_id: `$${kind}`,
    jump_event_id: '$original',
    sender: '@alice:example.org',
    sender_name: 'Alice',
    body: `${kind} preview`,
    ts: 1_700_000_000_000,
    kind,
    read,
    highlight: kind === 'mention',
    reaction_key: kind === 'reaction' ? '👍' : null,
    keyword: kind === 'keyword' ? 'Sable' : null,
    is_direct: false,
    encrypted: false,
    thread_root: null,
    reply: false,
  };
}

test('local read changes refresh the inbox, and unmount removes both subscriptions', async () => {
  core.session = { account_id: 'account' };
  core.rpc.notifications.inbox.mockResolvedValue({ items: [], has_more: false });
  core.rpc.notifications.backfillInbox.mockResolvedValue({ recorded: 0, has_more: false });
  const unsubscribe = vi.fn();
  core.subscribeEvents.mockReturnValue(unsubscribe);
  const view = render(FocusedNotificationList);
  await screen.findByText('这里暂时没有符合条件的通知。');
  const before = core.rpc.notifications.inbox.mock.calls.length;
  window.dispatchEvent(new Event('sable-focused-inbox-changed'));
  await vi.waitFor(() => {
    expect(core.rpc.notifications.inbox).toHaveBeenCalledTimes(before + 1);
  });
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(core.subscribeEvents.mock.calls.length);
  window.dispatchEvent(new Event('sable-focused-inbox-changed'));
  expect(core.rpc.notifications.inbox).toHaveBeenCalledTimes(before + 1);
});

test('filters persistent reaction, mention and keyword history, including read records', async () => {
  core.rpc.notifications.inbox.mockResolvedValue({
    items: [notification('reaction'), notification('mention', true), notification('keyword')],
    has_more: false,
  });
  render(FocusedNotificationList);
  await screen.findByText('reaction preview');
  expect(screen.getByText('mention preview')).toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(3);
  expect(screen.getByText('reaction preview').closest('a')).toHaveAttribute(
    'href',
    '/rooms/!room%3Aexample.org?event=%24original'
  );
  await fireEvent.click(screen.getByRole('button', { name: '表情' }));
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByText('reaction preview')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: '提及' }));
  expect(screen.getByText('mention preview')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: '仅未读' }));
  expect(screen.queryByText('mention preview')).not.toBeInTheDocument();
});

test('mark-all persists each notification without changing ordinary room receipts', async () => {
  roomList.rooms = [
    {
      room_id: '!ordinary:example.org',
      state: 'joined',
      room_kind: null,
      counts: { unread: 1, notifying: 1, highlight: 0, marked: false },
      latest_event: null,
    } as unknown as RoomListItemView,
  ];
  let records = [notification('reaction'), notification('mention'), notification('keyword', true)];
  core.rpc.notifications.inbox.mockImplementation(() => Promise.resolve({
    items: records,
    has_more: false,
  }));
  core.rpc.notifications.markNotificationSeen.mockImplementation(({ event_id }) => {
    records = records.map((item) => (item.event_id === event_id ? { ...item, read: true } : item));
    return Promise.resolve(null);
  });
  render(FocusedNotificationList);
  await screen.findByText('reaction preview');
  await fireEvent.click(screen.getByRole('button', { name: '全部标为已读' }));
  await vi.waitFor(() => {
    expect(screen.queryByLabelText('未读')).not.toBeInTheDocument();
  });
  expect(core.rpc.notifications.markNotificationSeen).toHaveBeenCalledTimes(2);
  expect(core.rpc.timeline.markRead).not.toHaveBeenCalled();
  expect(screen.getByText('reaction preview')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Mark Room as read/ })).toBeInTheDocument();
});

test('ordinary unread rooms keep an individual read action without a bulk button', async () => {
  roomList.rooms = [
    {
      room_id: '!ordinary:example.org',
      state: 'joined',
      room_kind: null,
      counts: { unread: 1, notifying: 1, highlight: 0, marked: false },
      latest_event: null,
    } as unknown as RoomListItemView,
  ];
  core.rpc.notifications.inbox.mockResolvedValue({ items: [], has_more: false });
  render(FocusedNotificationList);

  await screen.findByText('1 unread notification');
  expect(screen.queryByRole('button', { name: '全部标为已读' })).not.toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: /Mark Room as read/ }));
  expect(core.rpc.timeline.markRead).toHaveBeenCalledWith({
    room_id: '!ordinary:example.org',
    event_id: null,
    thread_root: null,
    subscription: null,
    fully_read: true,
  });
});
