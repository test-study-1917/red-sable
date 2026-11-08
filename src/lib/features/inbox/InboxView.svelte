<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Tabs } from 'bits-ui';
  import { i18n } from '#lib/i18n.js';
  import AppPageShell from '#lib/ui/primitives/AppPageShell.svelte';
  import { type InboxTab, parseInboxTab } from './inbox';
  import BookmarkList from './BookmarkList.svelte';
  import FocusedNotificationList from './FocusedNotificationList.svelte';
  const landing: InboxTab = 'notifications';
  let tab = $derived<InboxTab>(parseInboxTab(page.url.searchParams.get('tab'), landing));
  function selectTab(value: string): void {
    const url = new URL(page.url.href);
    if (value === landing) url.searchParams.delete('tab');
    else url.searchParams.set('tab', value);
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- rewrites current resolved URL
    void goto(`${url.pathname}${url.search}`, { replace: true, reset: false });
  }
</script>

<AppPageShell title={i18n.t('nav.inbox')} density="compact">
  <Tabs.Root bind:value={tab} onValueChange={selectTab} class="inbox">
    <Tabs.List class="inbox-tabs" aria-label={i18n.t('nav.inbox')}>
      <Tabs.Trigger value="notifications" class="inbox-tab">{i18n.t('inbox.notifications')}</Tabs.Trigger>
      <Tabs.Trigger value="bookmarks" class="inbox-tab">{i18n.t('inbox.bookmarks')}</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="notifications"><FocusedNotificationList /></Tabs.Content>
    <Tabs.Content value="bookmarks"><BookmarkList /></Tabs.Content>
  </Tabs.Root>
</AppPageShell>

<style>
  :global(.inbox) {
    display: grid;
    gap: var(--space-300);
  }

  :global(.inbox-tabs) {
    border-bottom: var(--border-width) solid var(--surface-container-line);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-300);
  }

  :global(.inbox-tab) {
    align-items: center;
    background: transparent;
    border: 0;
    border-bottom: var(--border-width-500) solid transparent;
    color: var(--surface-var-on-container);
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    gap: var(--space-200);
    min-height: var(--control-height-400);
    padding: var(--space-200) var(--space-100);
  }

  :global(.inbox-tab[data-state='active']) {
    border-bottom-color: var(--primary-main);
    color: var(--primary-main);
    font-weight: var(--font-weight-medium);
  }

  :global(.inbox-tab:hover) {
    background: var(--surface-container-hover);
  }




  @media (pointer: coarse) {
    :global(.inbox-tab) {
      min-height: 2.75rem;
    }
  }
</style>
