// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';

vi.mock('#lib/core/context.js');
vi.mock('#lib/rooms/room-list.svelte.js', () => ({
  useRoomList: () => ({ rooms: [], badgeUnreadFor: () => ({}), labelFor: () => 'Room' }),
}));

import { core } from '#lib/core/__mocks__/context.js';
import FocusedNotificationList from './FocusedNotificationList.svelte';

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
