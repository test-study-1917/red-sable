<script lang="ts">
  import { setContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { useCoreClient } from '#lib/core/context.js';
  import { afterOverlayPops } from '#lib/platform/overlay-back.svelte.js';
  import { roomSectionPath } from '#lib/rooms/permalink.js';
  import { useRoomList } from '#lib/rooms/room-list.svelte.js';
  import { activeRoomTimeline } from '#lib/rooms/timeline.svelte.js';
  import { preferences } from '#lib/settings/preferences.svelte.js';
  import RoomHistoryExportTools from '../room/RoomHistoryExportTools.svelte';
  import {
    HISTORY_EXPORT_CONTEXT,
    type RoomHistoryExportContext,
  } from '../room/room-history-export-context.js';

  let { roomId }: { roomId: string } = $props();
  const core = useCoreClient();
  const roomList = useRoomList();
  const timeline = activeRoomTimeline(core).timeline;
  const servesRoom = () => timeline.serves(roomId, preferences.showHiddenEvents);

  setContext(HISTORY_EXPORT_CONTEXT, {
    roomId: () => roomId,
    roomName: () => roomList.labelFor(roomId),
    timelineItems: () => timeline.loadedItems(roomId, preferences.showHiddenEvents),
    reachesStart: () => servesRoom() && timeline.backwardPagination === 'end',
    reachesLatest: () => servesRoom() && timeline.reachesLatest,
    members: () => [],
    readPage: (params) => core.rpc.timeline.historyPage(params),
    jumpToMessage: (eventId) => {
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- roomSectionPath resolves the target
      void afterOverlayPops().then(() => goto(roomSectionPath(roomList.rooms, roomId, eventId)));
    },
  } satisfies RoomHistoryExportContext);
</script>

<RoomHistoryExportTools browserBack />
