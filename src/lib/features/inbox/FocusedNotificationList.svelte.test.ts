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

test('core inbox changes refresh the list, and unmount removes the subscription', async () => {
  core.session = { account_id: 'account' };
  core.rpc.notifications.inbox.mockResolvedValue({ items: [], has_more: false });
  core.rpc.notifications.backfillInbox.mockResolvedValue({ recorded: 0, has_more: false });
  const unsubscribe = vi.fn();
  core.subscribeEvents.mockReturnValue(unsubscribe);
  const view = render(FocusedNotificationList);
  await screen.findByText('这里暂时没有符合条件的通知。');
  const before = core.rpc.notifications.inbox.mock.calls.length;
  const [emit] = core.subscribeEvents.mock.lastCall!;
  emit({ type: 'room_list_diff', subscription: 1, diffs: [], sections: null });
  expect(core.rpc.notifications.inbox).toHaveBeenCalledTimes(before);
  emit({ type: 'inbox_changed' });
  expect(core.rpc.notifications.inbox).toHaveBeenCalledTimes(before + 1);
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(core.subscribeEvents.mock.calls.length);
});

test('retries a failed initial history backfill without querying the local inbox again', async () => {
  core.rpc.notifications.inbox.mockResolvedValue({ items: [], has_more: false });
  core.rpc.notifications.backfillInbox.mockRejectedValueOnce(new Error('offline'));
  render(FocusedNotificationList);

  expect(await screen.findByRole('alert')).toHaveTextContent('读取历史通知失败');
  await fireEvent.click(screen.getByRole('button', { name: /重试/ }));

  expect(core.rpc.notifications.backfillInbox).toHaveBeenCalledTimes(2);
  expect(core.rpc.notifications.backfillInbox).toHaveBeenLastCalledWith({ include_read: true });
  await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(core.rpc.notifications.inbox).toHaveBeenCalledTimes(1);
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

test('mark-all writes one batch and reloads once without changing ordinary room receipts', async () => {
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
  core.rpc.notifications.inbox.mockImplementation(() =>
    Promise.resolve({ items: records, has_more: false })
  );
  render(FocusedNotificationList);
  await screen.findByText('reaction preview');
  const before = core.rpc.notifications.inbox.mock.calls.length;
  const [emit] = core.subscribeEvents.mock.lastCall!;
  core.rpc.notifications.markNotificationsSeen.mockImplementation(({ event_ids }) => {
    records = records.map((item) =>
      event_ids.includes(item.event_id) ? { ...item, read: true } : item
    );
    emit({ type: 'inbox_changed' });
    return Promise.resolve(null);
  });
  await fireEvent.click(screen.getByRole('button', { name: '全部标为已读' }));
  await vi.waitFor(() => {
    expect(screen.queryByLabelText('未读')).not.toBeInTheDocument();
  });
  expect(core.rpc.notifications.markNotificationsSeen).toHaveBeenCalledExactlyOnceWith({
    event_ids: ['$reaction', '$mention'],
  });
  expect(core.rpc.notifications.inbox).toHaveBeenCalledTimes(before + 1);
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
