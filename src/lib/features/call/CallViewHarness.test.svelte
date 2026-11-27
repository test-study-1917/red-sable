<script lang="ts">
  import type { ComponentProps } from 'svelte';

  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import RoomCallLayout from '../room/RoomCallLayout.svelte';
  import CallView from './CallView.svelte';

  let { splitChat = false, ...props }: ComponentProps<typeof CallView> & { splitChat?: boolean } =
    $props();
</script>

<TooltipProvider>
  {#if splitChat}
    <RoomCallLayout active docked>
      {#snippet callStage(roomLayout)}
        <CallView {...props} {roomLayout} />
      {/snippet}
      <textarea aria-label="Chat message"></textarea>
    </RoomCallLayout>
  {:else}
    <CallView {...props} />
  {/if}
</TooltipProvider>
