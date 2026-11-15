<script lang="ts">
  import PageTitle from '#lib/ui/primitives/PageTitle.svelte';
  import { resolve } from '$app/paths';
  import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDotsIcon';
  import CompassIcon from 'phosphor-svelte/lib/CompassIcon';
  import PlusCircleIcon from 'phosphor-svelte/lib/PlusCircleIcon';

  import { readReturningUser } from '#lib/features/auth/flow/auth-flow.svelte.js';
  import { i18n } from '#lib/i18n.js';
  import ActionCard from '#lib/ui/ActionCard.svelte';
  import SableBrandMark from '#lib/ui/SableBrandMark.svelte';
  import SettingsChangesCard from './SettingsChangesCard.svelte';

  interface Props {
    titleKey?: string;
  }

  let { titleKey = 'nav.home' }: Props = $props();
  const hasLoggedInBefore = readReturningUser();

  const startCards = [
    {
      href: resolve('explore'),
      icon: CompassIcon,
      title: 'home.findCommunityTitle',
      description: 'home.findCommunityDescription',
    },
    {
      href: resolve('create-room'),
      icon: PlusCircleIcon,
      title: 'home.startRoomTitle',
      description: 'home.startRoomDescription',
    },
    {
      href: resolve('direct'),
      icon: ChatCircleDotsIcon,
      title: 'home.joinConversationTitle',
      description: 'home.joinConversationDescription',
    },
  ];
</script>

<PageTitle title={i18n.t(titleKey)} />

<main class="home-page" aria-labelledby="home-title">
  <section class="hero">
    <SableBrandMark />
    <h1 id="home-title">
      {i18n.t(hasLoggedInBefore ? 'auth.welcomeBack' : 'auth.welcome')}
    </h1>
  </section>

  <SettingsChangesCard />

  <section class="start-section" aria-labelledby="start-title">
    <div class="section-heading">
      <h2 id="start-title">{i18n.t('home.nextStepsTitle')}</h2>
    </div>

    <div class="start-grid">
      {#each startCards as card (card.title)}
        <ActionCard
          icon={card.icon}
          title={i18n.t(card.title)}
          description={i18n.t(card.description)}
          href={card.href}
          disabled={!card.href}
        />
      {/each}
    </div>
  </section>
</main>

<style>
  .home-page {
    box-sizing: border-box;
    display: none;
    margin: 0 auto;
    max-width: 64rem;
    min-height: 100%;
    overflow: auto;
    padding: clamp(var(--space-500), 5vw, calc(var(--space-700) + var(--space-600)))
      var(--page-gutter) var(--space-900);
    width: 100%;
  }

  .hero {
    align-items: center;
    display: flex;
    flex-direction: column;
    padding: clamp(
        var(--space-700),
        7vw,
        calc(var(--space-700) + var(--space-600) + var(--space-500))
      )
      clamp(var(--space-500), 7vw, calc(var(--space-700) + var(--space-700) + var(--space-600)));
    text-align: center;
  }

  h1,
  h2 {
    margin: 0;
  }

  .hero h1 {
    font-size: var(--font-size-heading);
    line-height: var(--line-height-heading);
    margin: var(--space-400) 0 0;
  }

  .start-section {
    padding-top: clamp(
      calc(var(--space-700) + var(--space-300)),
      7vw,
      calc(var(--space-700) + var(--space-600) + var(--space-400))
    );
  }

  .section-heading {
    margin-bottom: var(--space-500);
  }

  .section-heading h2 {
    font-size: var(--font-size-heading);
    line-height: var(--line-height-heading);
  }

  .start-grid {
    display: grid;
    gap: var(--space-400);
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @media (--app-layout) {
    .home-page {
      display: block;
    }
  }
</style>
