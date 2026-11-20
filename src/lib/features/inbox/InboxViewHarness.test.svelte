<script lang="ts">
  import { useCoreClient } from '#lib/core/context.js';
  import { EventItems, provideEventItems } from '../room/messages/event-items.svelte.js';
  import { RoomScopes, provideRoomScopes } from '../room/messages/message-scope.svelte.js';
  import InboxView from './InboxView.svelte';

  // The real app layout provides both contexts to the inbox subtree.
  const core = useCoreClient();
  provideEventItems(new EventItems(core.rpc.timeline, () => core.session?.user_id ?? null));
  provideRoomScopes(new RoomScopes(core));
</script>

<InboxView />
