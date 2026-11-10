<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { createRpc, type RoomListItemView } from '#src/generated/protocol';
  import type { CoreClient } from '#lib/core/client.svelte.js';
  import { provideCoreClient } from '#lib/core/context.js';
  import { MemberPreviews } from '#lib/rooms/member-previews.svelte.js';
  import { RoomList, provideRoomList } from '#lib/rooms/room-list.svelte.js';
  import { PersonaStore, providePersonaStore } from '#lib/personas/personas.svelte.js';
  import { Bookmarks, provideBookmarks } from '#lib/rooms/bookmarks.svelte.js';
  import { PresenceStore, providePresenceStore } from '#lib/rooms/presence.svelte.js';
  import { EventItems, provideEventItems } from '#lib/features/room/messages/event-items.svelte.js';
  import RoomView from '#lib/features/room/RoomView.svelte';
  import { activeRoomTimeline } from '#lib/rooms/timeline.svelte.js';
  import { setPreference } from '#lib/settings/preferences.svelte.js';
  import { historyItems } from './timeline-items';

  let { callClient, voice = false }: { callClient: CoreClient; voice?: boolean } = $props();
  setPreference('threadPresentation', 'panel');
  const items = historyItems({
    idPrefix: 'dual',
    label: 'Conversation',
    count: 150,
    timestampBase: 1700000000000,
    body: (n) =>
      `Message ${n}: A readable conversation with a longer line that wraps when the chat column gets narrower.`,
  });
  items[149] = { ...items[149], is_own: true, sender: '@me:example.org', sender_name: 'Me' };
  const rpc = createRpc(async (method) => {
    switch (method) {
      case 'timeline.subscribe':
        return { subscription: 99, items };
      case 'timeline.event_items':
        return items;
      case 'timeline.read_marker':
        return null;
      case 'timeline.mark_read':
      case 'timeline.set_fully_read':
      case 'timeline.unsubscribe':
      case 'messages.set_typing':
        return null;
      case 'members.list':
      case 'members.power_level_tags':
      case 'room_state.abbreviations':
      case 'account.bookmarks':
      case 'messages.frequent_reactions':
      case 'messages.reaction_shortcodes':
      case 'room_state.bot_commands':
      case 'room_state.events':
      case 'rooms.replaced_rooms':
      case 'spaces.unjoined_space_parents':
        return [];
      case 'room_state.event':
      case 'room_state.member_list_threshold':
      case 'room_state.banner':
      case 'members.member':
        return null;
      case 'room_state.history_visibility':
        return 'shared';
      case 'rooms.via_servers':
        return [];
      case 'rooms.canonical_alias':
        return { alias: null, alt_aliases: [] };
      case 'personas.list':
        return { personas: [], selections: [] };
      case 'packs.list':
        return { packs: [], complete: true };
      case 'messages.media_config':
        return { upload_size: 10000000 };
      default:
        return new Promise(() => {});
    }
  });
  const core = {
    rpc,
    session: { user_id: '@me:example.org' },
    accounts: [],
    subscribeEvents: untrack(() => callClient.subscribeEvents),
    memberPreviews: new MemberPreviews(),
    cachedUserProfile: () => null,
    refreshSearchCoverage: () => Promise.resolve(),
    userProfile: () => new Promise(() => {}),
    forgetProfileFailure: () => {},
    onProfileChanged: () => () => {},
    fetchMedia: () => Promise.resolve(new Uint8Array()),
    forgetMedia: () => Promise.resolve(),
  } as unknown as CoreClient;
  const room: RoomListItemView = {
    room_id: '!room:example.org',
    display_name: 'Ordinary room',
    name: 'Ordinary room',
    display_avatar_url: null,
    direct_targets: [],
    join_rule: 'invite',
    topic_html: null,
    is_tombstoned: false,
    supports_knock: false,
    supports_restricted: false,
    supports_knock_restricted: false,
    bridge: null,
    marked_unread: false,
    notifying: 0,
    notification: { room: null, default: 'all' },
    latest_event: null,
    state: 'joined',
    room_kind: untrack(() => voice) ? 'voice' : null,
    is_direct: false,
    encrypted: false,
    topic: null,
    avatar_url: null,
    canonical_alias: null,
    space_children: [],
    call_participants: [],
    screen_sharers: [],
    counts: { unread: 0, notifying: 0, highlight: 0, marked: false },
    unread: 0,
    highlight: 0,
    tags: [],
  };
  onMount(() => {
    Object.assign(window, {
      appendDualMessage: () => {
        const timeline = activeRoomTimeline(core).timeline;
        timeline.items = [
          ...timeline.items,
          { ...items[0], id: 'arrival', event_id: '$arrival:example.test' },
        ];
      },
    });
  });
  provideCoreClient(core);
  const rooms = new RoomList(core);
  rooms.rooms = [room];
  provideRoomList(rooms);
  providePersonaStore(new PersonaStore(core));
  provideBookmarks(new Bookmarks(rpc.account));
  providePresenceStore(new PresenceStore());
  provideEventItems(new EventItems(rpc.timeline, () => '@me:example.org'));
</script>

<div class="fixture-room"><RoomView roomId="!room:example.org" {room} /></div>

<style>
  .fixture-room {
    display: flex;
    height: 100dvh;
    min-width: 0;
  }
</style>
