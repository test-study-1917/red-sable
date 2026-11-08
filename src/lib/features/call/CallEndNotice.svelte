<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import Alert from '#lib/ui/primitives/Alert.svelte';
  import Button from '#lib/ui/primitives/Button.svelte';

  import type { CallSession } from './call-session.svelte.js';

  let { session, compact = false }: { session: CallSession; compact?: boolean } = $props();
</script>

{#if session.endStatus === 'sending'}
  <Alert
    role="status"
    class={['end-notice', { compact }]}
    aria-label={compact ? i18n.t('call.endSending') : undefined}
  >
    {i18n.t(compact ? 'call.endSendingShort' : 'call.endSending')}
  </Alert>
{:else if session.endStatus === 'failed'}
  <Alert
    variant="critical"
    role="alert"
    class={['end-notice', { compact }]}
    aria-label={compact ? i18n.t('call.endFailed') : undefined}
  >
    <p>{i18n.t(compact ? 'call.endFailedShort' : 'call.endFailed')}</p>
    <div class="actions">
      {#if !compact}
        <Button variant="ghost" onclick={() => void session.leave()}>{i18n.t('call.leave')}</Button>
      {/if}
      <Button variant="primary" onclick={() => void session.endForEveryone()}>
        {i18n.t('call.retryEnd')}
      </Button>
    </div>
  </Alert>
{/if}

<style>
  :global(.end-notice.compact) {
    box-sizing: border-box;
    font-size: var(--font-size-small);
    min-inline-size: 0;
    overflow-wrap: anywhere;
    padding: var(--space-100);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-100);
    justify-content: flex-end;
  }
</style>
