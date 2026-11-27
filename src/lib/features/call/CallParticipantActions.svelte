<script lang="ts">
  import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeIcon';
  import { untrack } from 'svelte';
  import { i18n } from '#lib/i18n.js';
  import ActionMenu from '#lib/ui/primitives/ActionMenu.svelte';
  import ActionMenuItem from '#lib/ui/primitives/ActionMenuItem.svelte';
  import ConfirmDialog from '#lib/ui/primitives/ConfirmDialog.svelte';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import type { CallModerationAction } from './call-moderation';

  interface Props {
    name: string;
    muted: boolean;
    busy: boolean;
    onModerate: (action: CallModerationAction) => void;
    onOverlayChange?: (open: boolean) => void;
  }

  let { name, muted, busy, onModerate, onOverlayChange }: Props = $props();
  let menuOpen = $state(false);
  let confirmOpen = $state(false);
  let confirmRemove = $state.raw<(() => void) | undefined>();
  let overlayOpen = $derived(menuOpen || confirmOpen);

  $effect(() => {
    const report = onOverlayChange;
    if (!overlayOpen || !report) return;
    untrack(() => report(true));
    return () => report(false);
  });
</script>

<ActionMenu
  bind:open={menuOpen}
  label={i18n.t('call.participantActions', { name })}
  side="bottom"
  align="end"
>
  {#snippet trigger({ props })}
    <IconButton
      {...props}
      class="tile-action"
      variant="ghost"
      size="small"
      disabled={busy}
      label={i18n.t('call.participantActions', { name })}
    >
      <DotsThreeIcon weight="bold" />
    </IconButton>
  {/snippet}
  <ActionMenuItem disabled={busy || muted} onSelect={() => onModerate('mute')}>
    {i18n.t('call.muteMicrophone', { name })}
  </ActionMenuItem>
  <ActionMenuItem
    destructive
    disabled={busy}
    onSelect={() => {
      const selected = onModerate;
      confirmRemove = () => selected('remove');
      confirmOpen = true;
    }}
  >
    {i18n.t('call.removeParticipant', { name })}
  </ActionMenuItem>
</ActionMenu>

<ConfirmDialog
  bind:open={confirmOpen}
  title={i18n.t('call.removeConfirmTitle', { name })}
  description={i18n.t('call.removeConfirmDescription', { name })}
  confirmLabel={i18n.t('call.removeConfirmAction')}
  confirmDisabled={busy}
  onConfirm={() => {
    confirmOpen = false;
    confirmRemove?.();
    confirmRemove = undefined;
  }}
/>
