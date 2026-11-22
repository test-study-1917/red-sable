<script lang="ts">
  import { setContext } from 'svelte';
  import {
    HISTORY_EXPORT_CONTEXT,
    type RoomHistoryExportContext,
  } from './room-history-export-context.js';
  import type { RoomListItemView } from '#src/generated/protocol';
  import type { MatrixLink } from '#lib/rooms/matrix-link.js';
  import type { RoomMemberLoader } from '#lib/rooms/room-members.svelte.js';
  import RoomAttachmentsPanel from './RoomAttachmentsPanel.svelte';
  import RoomMembersPanel from './RoomMembersPanel.svelte';
  import RoomNotificationsPanel from './RoomNotificationsPanel.svelte';
  import RoomSearchPanel from './RoomSearchPanel.svelte';
  import RoomThreadsPanel from './RoomThreadsPanel.svelte';
  import RoomWidgetsPanel from './RoomWidgetsPanel.svelte';
  import type { RoomPanels } from './room-panels.svelte.js';
  import type { RoomSession } from './room-session.svelte.js';
  import { scopedSearchQuery } from './room-navigation.js';

  interface Props {
    panels: RoomPanels;
    room: RoomListItemView | undefined;
    roomId: string;
    roomName: string;
    historyItems: readonly unknown[];
    historyReachesLatest: boolean;
    onLoadHistory: (count: number) => Promise<boolean>;
    onOpenHistoryMedia: (eventId: string) => void;
    onJumpToHistoryMessage: (eventId: string) => void;
    autoOpenWidgetId?: string | null;
    onActiveWidgetChange?: (widgetId: string | null) => void;
    desktop: boolean;
    memberLoader: RoomMemberLoader;
    roomSession: RoomSession;
    canManageWidgets: boolean;
    onOpenThread: (rootEventId: string) => void;
    onJump: (eventId: string) => void;
    onMatrixLink: (link: MatrixLink, anchor: HTMLAnchorElement) => void;
    onMemberProfile: (userId: string, anchor: HTMLElement) => void;
  }

  let {
    panels,
    room,
    roomId,
    roomName,
    historyItems,
    historyReachesLatest,
    onLoadHistory,
    onOpenHistoryMedia,
    onJumpToHistoryMessage,
    autoOpenWidgetId = null,
    onActiveWidgetChange,
    desktop,
    memberLoader,
    roomSession,
    canManageWidgets,
    onOpenThread,
    onJump,
    onMatrixLink,
    onMemberProfile,
  }: Props = $props();
  setContext(HISTORY_EXPORT_CONTEXT, {
    roomId: () => roomId,
    roomName: () => roomName,
    timelineItems: () => historyItems,
    reachesLatest: () => historyReachesLatest,
    members: () => memberLoader.members,
    loadOlder: (count: number) => onLoadHistory(count),
    openMedia: (eventId: string) => onOpenHistoryMedia(eventId),
    jumpToMessage: (eventId: string) => onJumpToHistoryMessage(eventId),
  } satisfies RoomHistoryExportContext);
</script>

{#if panels.threadsOpen}
  <RoomThreadsPanel
    {roomId}
    members={memberLoader.members}
    modal={!desktop}
    {onOpenThread}
    onClose={() => (panels.threadsOpen = false)}
  />
{/if}

{#if panels.searchOpen}
  {#key roomId}
    <RoomSearchPanel
      query={scopedSearchQuery('in', room, roomId)}
      modal={!desktop}
      onClose={() => (panels.searchOpen = false)}
    />
  {/key}
{/if}

{#if panels.notificationsOpen}
  {#key roomId}
    <RoomNotificationsPanel
      {roomId}
      members={memberLoader.members}
      modal={!desktop}
      {onJump}
      onClose={() => (panels.notificationsOpen = false)}
    />
  {/key}
{/if}

{#if panels.attachmentsOpen}
  <RoomAttachmentsPanel
    {roomId}
    members={memberLoader.members}
    modal={!desktop}
    {onJump}
    {onMatrixLink}
    onClose={() => (panels.attachmentsOpen = false)}
  />
{/if}

<RoomMembersPanel {panels} {roomId} {desktop} {memberLoader} {roomSession} {onMemberProfile} />

<RoomWidgetsPanel
  {autoOpenWidgetId}
  {onActiveWidgetChange}
  {panels}
  {roomId}
  {desktop}
  {memberLoader}
  {roomSession}
  canManage={canManageWidgets}
/>
