<script lang="ts">
  import type { InboxItemView } from '#src/generated/protocol';
  import { goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { useCoreClient } from '#lib/core/context.js';
  import { roomSectionPath } from '#lib/rooms/permalink.js';
  import { useRoomList } from '#lib/rooms/room-list.svelte.js';
  import { afterOverlayPops } from '#lib/platform/overlay-back.svelte.js';
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
    item.kind === 'reaction' || item.kind === 'mention' || item.kind === 'keyword' ||
    (!item.kind && item.highlight);
  const kindOf = (item: InboxItemView): Kind =>
    item.kind === 'reaction' || item.kind === 'mention' || item.kind === 'keyword'
      ? item.kind : 'mention';
  let visible = $derived(
    items.filter((item) => eligible(item) && (!unreadOnly || !item.read) &&
      (filter === 'all' || kindOf(item) === filter))
  );
  async function reload(): Promise<void> {
    if (!core.session) return;
    const serial = ++fetchSerial;
    try {
      const response = await core.rpc.notifications.inbox({
        filter: 'all', include_read: true, limit: 20000, before_ts: null,
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
    } finally { historyLoading = false; }
  }
  async function markOne(item: InboxItemView): Promise<void> {
    if (item.read) return;
    await core.rpc.notifications.markNotificationSeen({ event_id: item.event_id });
    // Do not wait for a remote notification event to remove the red dot.
    items = items.map((entry) => entry.event_id === item.event_id ? { ...entry, read: true } : entry);
    window.dispatchEvent(new Event('sable-focused-inbox-changed'));
  }
  async function visit(item: InboxItemView, event: MouseEvent): Promise<void> {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    try { await markOne(item); }
    catch (cause) { console.warn('[sable focused inbox] mark read failed', cause); }
    const href = roomSectionPath(roomList.rooms, item.room_id, item.jump_event_id || item.event_id);
     
    await afterOverlayPops();
    void goto(href);
  }
  async function markAllRead(): Promise<void> {
    for (const item of items.filter((entry) => eligible(entry) && !entry.read)) {
      try { await markOne(item); }
      catch (cause) { console.warn('[sable focused inbox] mark all failed', cause); }
    }
    await reload();
  }
  $effect(() => {
    const account = core.session?.account_id ?? '';
    if (!account) { items = []; lastAccount = ''; loading = false; return; }
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
    const localChange = () => { void reload(); };
    window.addEventListener('sable-focused-inbox-changed', localChange);
    return () => {
      stop();
      window.removeEventListener('sable-focused-inbox-changed', localChange);
    };
  });
  onDestroy(() => { fetchSerial += 1; });
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
        <button type="button" class:chosen={filter === option.key}
          aria-pressed={filter === option.key} onclick={() => { filter = option.key; }}>
          {option.label}
        </button>
      {/each}
      <button type="button" class:chosen={unreadOnly} aria-pressed={unreadOnly}
        onclick={() => { unreadOnly = !unreadOnly; }}>仅未读</button>
    </div>
    {#if items.some((item) => eligible(item) && !item.read)}
      <button class="mark-all" type="button" onclick={() => void markAllRead()}>全部标为已读</button>
    {/if}
  </div>


  {#if error}<p class="error" role="alert">{error} <button type="button" onclick={() => void reload()}>重试</button></p>{/if}
  {#if loading}<p class="empty">正在读取通知…</p>
  {:else if visible.length === 0}<p class="empty">这里暂时没有符合条件的通知。</p>
  {:else}
    <ul class="notification-feed">
      {#each visible as item (item.event_id)}
        <li class:read={item.read}>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- roomSectionPath resolves this link -->
          <a class="notification-entry"
            href={roomSectionPath(roomList.rooms, item.room_id, item.jump_event_id || item.event_id)}
            onclick={(event) => void visit(item, event)}>
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
  {#if hasOlder}
    <button class="older-button" type="button" disabled={historyLoading}
      onclick={() => void backfill()}>{historyLoading ? '正在读取…' : '加载更早的通知'}</button>
  {/if}
</section>
<style>
  .older-button { justify-self: center; background: transparent; border: 1px solid var(--surface-container-line); padding: var(--space-200) var(--space-400); border-radius: var(--radius-pill); }
  .focused-inbox { display: grid; gap: var(--space-300); }
  .notification-controls { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-200); }
  .filter-options { display: flex; flex-wrap: wrap; gap: var(--space-100); }
  button { color: inherit; cursor: pointer; font: inherit; }
  .filter-options button, .mark-all { border: 0; border-radius: var(--radius-pill); background: transparent; padding: var(--space-200) var(--space-300); }
  .filter-options button:hover, .mark-all:hover { background: var(--surface-container-hover); }
  .filter-options button.chosen { background: var(--primary-container); color: var(--primary-on-container); }
  .notification-feed { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-150); }
  .notification-feed li { border: 1px solid var(--surface-container-line); border-radius: var(--radius); overflow: hidden; }
  .notification-feed li.read { opacity: .7; }
  .notification-entry { display: grid; gap: var(--space-150); position: relative; padding: var(--space-300) var(--space-400); color: inherit; text-decoration: none; }
  .notification-entry:hover, .notification-entry:focus-visible { background: var(--surface-container-hover); }
  .entry-top { display: flex; align-items: center; flex-wrap: wrap; column-gap: var(--space-250); row-gap: var(--space-100); }
  .entry-top time { margin-left: auto; font-size: var(--font-size-small); opacity: .75; }
  .kind { color: var(--primary-main); }
  .entry-room { font-size: var(--font-size-small); opacity: .75; }
  .entry-preview { overflow: hidden; overflow-wrap: anywhere; max-width: 85ch; margin: 0; font-size: var(--font-size-body); display: -webkit-box; line-clamp: 2; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .unread-mark { position: absolute; right: .5rem; top: .5rem; width: .45rem; height: .45rem; background: var(--supporter-red); border-radius: 50%; }
  .empty { text-align: center; margin: var(--space-600) 0; color: var(--surface-var-on-container); }
  .error { color: var(--crit-main); }

</style>
