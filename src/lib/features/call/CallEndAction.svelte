<script lang="ts">
  import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
  import PhoneDisconnectIcon from 'phosphor-svelte/lib/PhoneDisconnectIcon';

  import { i18n } from '#lib/i18n.js';
  import ActionMenu from '#lib/ui/primitives/ActionMenu.svelte';
  import ActionMenuItem from '#lib/ui/primitives/ActionMenuItem.svelte';
  import ConfirmDialog from '#lib/ui/primitives/ConfirmDialog.svelte';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import Tooltip from '#lib/ui/primitives/Tooltip.svelte';
  import { formatBinding } from '#lib/ui/shortcuts/binding.js';
  import { effectiveShortcuts } from '#lib/ui/shortcuts/bindings.svelte.js';
  import { isMacPlatform } from '#lib/ui/shortcuts/global-shortcuts.js';

  import type { CallSession } from './call-session.svelte.js';

  interface Props {
    session: CallSession;
    compact?: boolean;
    onOverlayChange?: (open: boolean) => void;
  }

  let { session, compact = false, onOverlayChange }: Props = $props();
  let menuOpen = $state(false);
  let confirmOpen = $state(false);
  let offerMenu = $derived(
    session.canEndForEveryone || session.endStatus === 'sending' || session.endStatus === 'failed'
  );
  let hangUpTip = $derived.by(() => {
    const binding = effectiveShortcuts().find((shortcut) => shortcut.id === 'call.hangUp')?.binding;
    return `${i18n.t('call.hangUp')}${binding ? ` (${formatBinding(binding, isMacPlatform())})` : ''}`;
  });

  $effect(() => {
    onOverlayChange?.(menuOpen || confirmOpen);
    return () => onOverlayChange?.(false);
  });
</script>

<div class="end-action">
  <Tooltip label={hangUpTip} side={compact ? 'right' : 'top'}>
    {#snippet trigger({ props })}
      <IconButton
        {...props}
        class="hang-up"
        variant="danger"
        size={compact ? 'small' : 'large'}
        label={i18n.t('call.hangUp')}
        onclick={() => void session.leave()}
      >
        <PhoneDisconnectIcon weight="fill" />
      </IconButton>
    {/snippet}
  </Tooltip>
  {#if offerMenu}
    <ActionMenu
      bind:open={menuOpen}
      label={i18n.t('call.endOptions')}
      side="top"
      align="end"
      sideOffset={12}
    >
      {#snippet trigger({ props })}
        <IconButton
          {...props}
          class="end-caret"
          variant="ghost"
          size={compact ? 'small' : 'medium'}
          label={i18n.t('call.endOptions')}
        >
          <CaretUpIcon weight="bold" />
        </IconButton>
      {/snippet}
      <ActionMenuItem onSelect={() => void session.leave()}>{i18n.t('call.leave')}</ActionMenuItem>
      {#if session.endStatus === 'failed'}
        <ActionMenuItem destructive onSelect={() => void session.endForEveryone()}>
          {i18n.t('call.retryEnd')}
        </ActionMenuItem>
      {:else}
        <ActionMenuItem
          destructive
          disabled={!session.canEndForEveryone || session.endStatus === 'sending'}
          onSelect={() => (confirmOpen = true)}
        >
          {i18n.t('call.endForEveryone')}
        </ActionMenuItem>
      {/if}
    </ActionMenu>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title={i18n.t('call.endConfirmTitle')}
  description={i18n.t('call.endConfirmDescription')}
  confirmLabel={i18n.t('call.endConfirmAction')}
  onConfirm={() => {
    confirmOpen = false;
    void session.endForEveryone();
  }}
/>

<style>
  .end-action {
    align-items: center;
    display: flex;
    gap: var(--space-050);
    min-width: 0;
    width: 100%;
  }

  .end-action :global(.hang-up) {
    flex: 1 1 auto;
  }
</style>
