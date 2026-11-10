<script lang="ts">
  import type { MemberView } from '#src/generated/protocol';
  import { useCallSession } from '#lib/features/call/call-session.svelte.js';
  import { openSettingsOver } from '#lib/features/settings/settings-navigation.js';

  import type { RoomCallLayoutState } from './room-call-layout.svelte.js';

  interface Props {
    layout?: RoomCallLayoutState;
    members: MemberView[];
    onInvite?: () => void;
  }

  let { layout, members, onInvite }: Props = $props();
  const call = useCallSession();
</script>

<div class="call-stage">
  {#await import('#lib/features/call/CallView.svelte') then { default: CallView }}
    <CallView
      session={call}
      roomLayout={layout}
      {members}
      {onInvite}
      onOpenSettings={(event: MouseEvent) => openSettingsOver(event, 'calls')}
    />
  {/await}
</div>

<style>
  .call-stage {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
    position: relative;
  }
</style>
