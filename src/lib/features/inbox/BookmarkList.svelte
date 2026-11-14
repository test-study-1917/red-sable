<script lang="ts">
  import type { BookmarkView } from '#src/generated/protocol';
  import { tick } from 'svelte';
  import XIcon from 'phosphor-svelte/lib/XIcon';

  import { i18n } from '#lib/i18n.js';
  import { formatMessageTimestamp } from '#lib/ui/date-time.js';
  import { useBookmarks } from '#lib/rooms/bookmarks.svelte.js';
  import { useRoomList } from '#lib/rooms/room-list.svelte.js';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import SearchField from '#lib/ui/primitives/SearchField.svelte';
  import { toasts } from '#lib/ui/toasts.svelte.js';
  import { useCoreClient } from '#lib/core/context.js';
  import { DisplayNames } from './display-names.svelte';
  import { useEventItems } from '../room/messages/event-items.svelte.js';
  import SenderName from '../room/members/SenderName.svelte';
  import { senderDisplayColors } from '../room/members/members.js';
  import { filteredBookmarks, focusRowAt, formatCompactTimestamp } from './inbox';
  import InboxFeedRow from './InboxFeedRow.svelte';
  import InboxSectionHeader from './InboxSectionHeader.svelte';
  import Tooltip from '#lib/ui/primitives/Tooltip.svelte';

  let { standalone = false }: { standalone?: boolean } = $props();
  const bookmarks = useBookmarks();
  const roomList = useRoomList();
  const core = useCoreClient();
  const names = new DisplayNames(core);
  const eventItems = useEventItems();
  $effect(() => core.onProfileChanged(names.forget));
  const headingId = $props.id();

  let query = $state('');
  let section = $state<HTMLElement>();
  let heading = $state<HTMLElement>();

  $effect(() => {
    void bookmarks.load();
  });

  let visible = $derived(filteredBookmarks(bookmarks.entries, query));

  function roomName(roomId: string, fallback: string | null): string {
    const room = roomList.byId(roomId);
    return room ? room.display_name : (fallback ?? roomId);
  }

  async function toggle(bookmark: BookmarkView): Promise<boolean> {
    try {
      await bookmarks.toggle(bookmark.room_id, bookmark.event_id);
      return true;
    } catch (error) {
      console.warn('[sable inbox] updating the bookmark failed', error);
      toasts.error(i18n.t('errors.actionFailed'));
      return false;
    }
  }

  async function remove(bookmark: BookmarkView, name: string, item: HTMLElement): Promise<void> {
    const index = visible.indexOf(bookmark);
    const hadFocus = item.contains(document.activeElement);
    if (!(await toggle(bookmark))) return;
    await tick();
    if (hadFocus) focusRowAt(section, heading, index);
    toasts.undoable(i18n.t('inbox.bookmarkRemoved', { room: name }), {
      label: i18n.t('common.undo'),
      onUndo: () => {
        void toggle(bookmark).then((restored) => {
          if (restored) void bookmarks.load();
        });
      },
    });
  }
</script>

<section aria-labelledby={headingId} bind:this={section}>
  <InboxSectionHeader
    id={headingId}
    title={i18n.t('inbox.bookmarks')}
    hidden={standalone}
    bind:heading
  />

  {#if bookmarks.entries.length > 1}
    <div
      class="search"
      {@attach (node) => {
        if (standalone) node.querySelector('input')?.focus();
      }}
    >
      <SearchField bind:value={query} label={i18n.t('inbox.bookmarksSearchLabel')} />
    </div>
  {/if}

  {#if bookmarks.entries.length === 0}
    <p class="empty">{i18n.t('inbox.bookmarksEmpty')}</p>
  {:else if visible.length === 0}
    <p class="empty">{i18n.t('inbox.bookmarksNoResults', { query })}</p>
  {:else}
    <ul class="feed">
      {#each visible as bookmark (bookmark.bookmark_id)}
        {@const name = roomName(bookmark.room_id, bookmark.room_name)}
        {@const savedEvent = eventItems.get(bookmark.room_id, bookmark.event_id)}
        {@const senderId = savedEvent?.sender ?? bookmark.sender}
        {@const globalName = senderId ? names.name(senderId) : null}
        {@const from = savedEvent?.sender_name ?? globalName}
        {@const previewText =
          savedEvent?.content.kind === 'message'
            ? savedEvent.content.body
            : (bookmark.body_preview ?? i18n.t('inbox.bookmarkPreviewEmpty'))}
        {@const timestampLabel = formatMessageTimestamp(bookmark.bookmarked_ts)}
        <InboxFeedRow roomId={bookmark.room_id} eventId={bookmark.event_id} {name} compact>
          <span class="head">
            <span class="name">{name}</span>
            <span class="preview" title={previewText}>
              {#if from && senderId}
                <span class="sender">
                  <SenderName
                    displayName={from}
                    colors={senderDisplayColors(senderId, names.profile(senderId))}
                    compact
                  />：
                </span>
              {/if}{previewText}
            </span>
            <Tooltip label={timestampLabel}>
              {#snippet trigger({ props })}
                <time
                  {...props}
                  class="when"
                  datetime={new Date(bookmark.bookmarked_ts).toISOString()}
                  >{formatCompactTimestamp(bookmark.bookmarked_ts)}</time
                >
              {/snippet}
            </Tooltip>
          </span>
          {#snippet trailing()}
            <IconButton
              class="remove"
              variant="ghost"
              size="small"
              label={i18n.t('inbox.removeBookmark', { room: name })}
              onclick={(event) => {
                const item = event.currentTarget.closest('li');
                if (item) void remove(bookmark, name, item);
              }}
            >
              <XIcon />
            </IconButton>
          {/snippet}
        </InboxFeedRow>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .search {
    margin-bottom: var(--space-300);
  }

  .feed {
    background: var(--bg-container);
    border: var(--border-width) solid var(--bg-container-line);
    border-radius: var(--radius);
    color: var(--bg-on-container);
    list-style: none;
    margin: 0;
    overflow: hidden;
    padding: 0;
  }

  .head {
    align-items: center;
    display: flex;
    gap: var(--space-200);
    min-width: 0;
    width: 100%;
    overflow: hidden;
    white-space: nowrap;
  }

  .name {
    flex: 0 1 11rem;
    max-width: 28%;
    min-width: 0;
    font-weight: var(--font-weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .when {
    color: var(--surface-var-on-container);
    flex: 0 0 auto;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
  }

  .preview {
    color: var(--surface-var-on-container);
    display: block;
    flex: 1 1 0;
    min-width: 0;
    font-size: var(--font-size-small);
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sender {
    font-weight: var(--font-weight-medium);
  }

  .empty {
    color: var(--surface-var-on-container);
    margin: 0;
    text-align: center;
  }
  /* SABLE_DEV_INBOX_V6: force single-row bookmark preview; dev/HMR friendly. */
  .feed :global(li.compact) {
    flex-wrap: nowrap;
    min-width: 0;
  }
  .feed :global(li.compact .row) {
    min-width: 0;
    padding: var(--space-100) var(--space-250);
  }
  .feed :global(li.compact .body) {
    display: block;
    min-width: 0;
  }
  .feed :global(li.compact .avatar-root) {
    --avatar-size: var(--avatar-size-200);
  }
  .feed :global(li.compact .message) {
    display: none;
  }
  .head {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    gap: var(--space-200);
    overflow: hidden;
    white-space: nowrap;
  }
  .name {
    flex: 0 1 11rem;
    max-width: 28%;
    min-width: 0;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }
  .preview {
    display: block;
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }
  .when { flex: none; }

</style>
