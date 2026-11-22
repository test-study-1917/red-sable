<script lang="ts">
  import type { InboxItemView } from '#src/generated/protocol';
  import { goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { on } from 'svelte/events';
  import { useCoreClient } from '#lib/core/context.js';
  import { roomSectionPath } from '#lib/rooms/permalink.js';
  import { useRoomList } from '#lib/rooms/room-list.svelte.js';
  import { afterOverlayPops } from '#lib/platform/overlay-back.svelte.js';
  import { i18n } from '#lib/i18n.js';
  import ChecksIcon from 'phosphor-svelte/lib/ChecksIcon';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import InboxFeedRow from './InboxFeedRow.svelte';
  import { notificationCount, unlistedNotifications } from './inbox';
  type Kind = 'all' | 'reaction' | 'mention' | 'keyword';
  const core = useCoreClient();
  const roomList = useRoomList();
  const filterNames: { key: Kind; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'reaction', label: '表情' },
    { key: 'mention', label: '提及' },
    { key: 'keyword', label: '关键词' },
  ];
  let items = $state<InboxItemView[]>([]);
  let filter = $state<Kind>('all');
  // SABLE_NOTIFICATION_HISTORY_V7: default to a persistent all-notifications view.
  let unreadOnly = $state(false);
  let loading = $state(true);
  let error = $state('');
  let hasOlder = $state(false);
  let historyLoading = $state(false);
  let fetchSerial = 0;
  let lastAccount = '';
  const eligible = (item: InboxItemView): boolean =>
    item.kind === 'reaction' ||
    item.kind === 'mention' ||
    item.kind === 'keyword' ||
    (!item.kind && item.highlight);
  const kindOf = (item: InboxItemView): Kind =>
    item.kind === 'reaction' || item.kind === 'mention' || item.kind === 'keyword'
      ? item.kind
      : 'mention';
  let visible = $derived(
    items.filter(
      (item) =>
        eligible(item) &&
        (!unreadOnly || !item.read) &&
        (filter === 'all' || kindOf(item) === filter)
    )
  );
  // Preserve the upstream ability to reach a room counted in the badge even
  // when the compact reaction/mention/keyword history has no matching event.
  let unlisted = $derived(
    !loading && !error && filter === 'all'
      ? unlistedNotifications(
          roomList.rooms,
          'all',
          roomList.badgeUnreadFor,
          items.filter((entry) => eligible(entry) && !entry.read).map((entry) => entry.room_id)
        )
      : []
  );
  async function reload(): Promise<void> {
    if (!core.session) return;
    const serial = ++fetchSerial;
    try {
      const response = await core.rpc.notifications.inbox({
        filter: 'all',
        include_read: true,
        limit: 20000,
        before_ts: null,
      });
      if (serial !== fetchSerial) return;
      items = response.items;
      error = '';
    } catch (cause) {
      if (serial !== fetchSerial) return;
      console.warn('[sable focused inbox] load failed', cause);
      error = '通知加载失败，可以重试。';
    } finally {
      if (serial === fetchSerial) loading = false;
    }
  }
  async function backfill(): Promise<void> {
    if (historyLoading) return;
    historyLoading = true;
    try {
      const result = await core.rpc.notifications.backfillInbox({ include_read: true });
      hasOlder = result.has_more;
      await reload();
    } catch (cause) {
      console.warn('[sable focused inbox] backfill failed', cause);
      error = '读取历史通知失败，可以重试。';
    } finally {
      historyLoading = false;
    }
  }
  async function markOne(item: InboxItemView): Promise<void> {
    if (item.read) return;
    await core.rpc.notifications.markNotificationSeen({ event_id: item.event_id });
    // Do not wait for a remote notification event to remove the red dot.
    items = items.map((entry) =>
      entry.event_id === item.event_id ? { ...entry, read: true } : entry
    );
    window.dispatchEvent(new Event('sable-focused-inbox-changed'));
  }
  async function visit(item: InboxItemView, event: MouseEvent): Promise<void> {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    event.preventDefault();
    try {
      await markOne(item);
    } catch (cause) {
      console.warn('[sable focused inbox] mark read failed', cause);
    }
    const href = roomSectionPath(roomList.rooms, item.room_id, item.jump_event_id || item.event_id);

    await afterOverlayPops();
    void goto(href);
  }
  async function markUnlistedRead(roomId: string): Promise<void> {
    try {
      await core.rpc.timeline.markRead({
        room_id: roomId,
        event_id: null,
        thread_root: null,
        subscription: null,
        fully_read: true,
      });
    } catch (cause) {
      console.warn('[sable focused inbox] marking unlisted room read failed', cause);
    }
  }
  async function markAllRead(): Promise<void> {
    for (const item of items.filter((entry) => eligible(entry) && !entry.read)) {
      try {
        await markOne(item);
      } catch (cause) {
        console.warn('[sable focused inbox] mark all failed', cause);
      }
    }
    await reload();
  }
  $effect(() => {
    const account = core.session?.account_id ?? '';
    if (!account) {
      items = [];
      lastAccount = '';
      loading = false;
      return;
    }
    if (account !== lastAccount) {
      lastAccount = account;
      items = [];
      loading = true;
      void reload();
      void backfill();
    }
    const stop = core.subscribeEvents((event) => {
      if (event.type === 'inbox_changed' || event.type === 'room_list_diff') void reload();
    });
    const localChange = () => {
      void reload();
    };
    const stopLocal = on(window, 'sable-focused-inbox-changed', localChange);
    return () => {
      stop();
      stopLocal();
    };
  });
  onDestroy(() => {
    fetchSerial += 1;
  });
  function when(ts: number): string {
    return new Date(ts).toLocaleString();
  }
  function label(item: InboxItemView): string {
    if (item.kind === 'reaction') return `回应了你的消息 ${item.reaction_key ?? ''}`;
    if (item.kind === 'keyword') return `提到了关键词「${item.keyword ?? ''}」`;
    return '提到了你';
  }
</script>

<section class="focused-inbox" aria-label="通知记录">
  <div class="notification-controls">
    <div class="filter-options" role="group" aria-label="通知分类">
      {#each filterNames as option (option.key)}
        <button
          type="button"
          class:chosen={filter === option.key}
          aria-pressed={filter === option.key}
          onclick={() => {
            filter = option.key;
          }}
        >
          {option.label}
        </button>
      {/each}
      <button
        type="button"
        class:chosen={unreadOnly}
        aria-pressed={unreadOnly}
        onclick={() => {
          unreadOnly = !unreadOnly;
        }}>仅未读</button
      >
    </div>
    {#if items.some((item) => eligible(item) && !item.read)}
      <button class="mark-all" type="button" onclick={() => void markAllRead()}>全部标为已读</button
      >
    {/if}
  </div>

  {#if error}<p class="error" role="alert">
      {error} <button type="button" onclick={() => void reload()}>重试</button>
    </p>{/if}
  {#if loading}<p class="empty">正在读取通知…</p>
  {:else if visible.length === 0 && unlisted.length === 0}
    <p class="empty">这里暂时没有符合条件的通知。</p>
  {:else}
    {#if visible.length > 0}
      <ul class="notification-feed">
        {#each visible as item (item.event_id)}
          <li class:read={item.read}>
            <a
              class="notification-entry"
              href={roomSectionPath(
                roomList.rooms,
                item.room_id,
                item.jump_event_id || item.event_id
              )}
              onclick={(event) => void visit(item, event)}
            >
              <div class="entry-top">
                <strong>{item.sender_name || item.sender}</strong>
                <span class="kind">{label(item)}</span>
                <time datetime={new Date(item.ts).toISOString()}>{when(item.ts)}</time>
              </div>
              <div class="entry-room">{roomList.labelFor(item.room_id)}</div>
              {#if item.body}<p class="entry-preview">{item.body}</p>{/if}
              {#if !item.read}<span class="unread-mark" aria-label="未读"></span>{/if}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
    {#if unlisted.length > 0}
      <ul class="unlisted-feed">
        {#each unlisted as room (room.room_id)}
          {@const name = roomList.labelFor(room.room_id)}
          {@const count = notificationCount(roomList.badgeUnreadFor(room))}
          <InboxFeedRow
            compact
            roomId={room.room_id}
            eventId={room.latest_event?.event_id ?? ''}
            {name}
          >
            <strong class="unlisted-name">{name}</strong>
            {#snippet message()}
              <p class="unlisted-count">
                {i18n.t('inbox.unlistedNotifications', {
                  count,
                  defaultValue: `${count} unread notifications`,
                })}
              </p>
            {/snippet}
            {#snippet trailing()}
              <IconButton
                variant="ghost"
                size="small"
                label={i18n.t('inbox.markRead', {
                  room: name,
                  defaultValue: `Mark ${name} as read`,
                })}
                onclick={() => void markUnlistedRead(room.room_id)}><ChecksIcon /></IconButton
              >
            {/snippet}
          </InboxFeedRow>
        {/each}
      </ul>
    {/if}
  {/if}
  {#if hasOlder}
    <button
      class="older-button"
      type="button"
      disabled={historyLoading}
      onclick={() => void backfill()}>{historyLoading ? '正在读取…' : '加载更早的通知'}</button
    >
  {/if}
</section>

<style>
  .older-button {
    background: transparent;
    border: 1px solid var(--surface-container-line);
    border-radius: var(--radius-pill);
    justify-self: center;
    padding: var(--space-200) var(--space-400);
  }

  .focused-inbox {
    display: grid;
    gap: var(--space-300);
  }

  .notification-controls {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-200);
    justify-content: space-between;
  }

  .filter-options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-100);
  }

  button {
    color: inherit;
    cursor: pointer;
    font: inherit;
  }

  .filter-options button,
  .mark-all {
    background: transparent;
    border: 0;
    border-radius: var(--radius-pill);
    padding: var(--space-200) var(--space-300);
  }

  .filter-options button:hover,
  .mark-all:hover {
    background: var(--surface-container-hover);
  }

  .filter-options button.chosen {
    background: var(--primary-container);
    color: var(--primary-on-container);
  }

  .notification-feed {
    display: grid;
    gap: var(--space-150);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .unlisted-feed {
    border: 1px solid var(--surface-container-line);
    border-radius: var(--radius);
    list-style: none;
    margin: 0;
    overflow: hidden;
    padding: 0;
  }

  .unlisted-name {
    font-size: var(--font-size-body);
  }

  .unlisted-count {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    margin: 0;
  }

  .notification-feed li {
    border: 1px solid var(--surface-container-line);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .notification-feed li.read {
    opacity: 0.7;
  }

  .notification-entry {
    color: inherit;
    display: grid;
    gap: var(--space-150);
    padding: var(--space-300) var(--space-400);
    position: relative;
    text-decoration: none;
  }

  .notification-entry:hover,
  .notification-entry:focus-visible {
    background: var(--surface-container-hover);
  }

  .entry-top {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-100) var(--space-250);
  }

  .entry-top time {
    font-size: var(--font-size-small);
    margin-inline-start: auto;
    opacity: 0.75;
  }

  .kind {
    color: var(--primary-main);
  }

  .entry-room {
    font-size: var(--font-size-small);
    opacity: 0.75;
  }

  .entry-preview {
    -webkit-box-orient: vertical;
    display: -webkit-box;
    font-size: var(--font-size-body);
    -webkit-line-clamp: 2;
    line-clamp: 2;
    margin: 0;
    max-width: 85ch;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .unread-mark {
    background: var(--supporter-red);
    border-radius: 50%;
    height: 0.45rem;
    inset-inline-end: 0.5rem;
    position: absolute;
    top: 0.5rem;
    width: 0.45rem;
  }

  .empty {
    color: var(--surface-var-on-container);
    margin: var(--space-600) 0;
    text-align: center;
  }

  .error {
    color: var(--crit-main);
  }
</style>
