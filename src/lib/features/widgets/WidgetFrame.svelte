<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { type Capability, ClientWidgetApi, Widget } from 'matrix-widget-api';

  import { useCoreClient } from '#lib/core/context.js';

  import { SableWidgetDriver } from './widget-driver.js';
  import { startWidgetFeed } from './widget-feed.js';

  interface Props {
    roomId: string;
    widgetId: string;
    url: string;
    name: string;
    onCapabilities: (requested: Set<Capability>) => Promise<Set<Capability>>;
  }

  let { roomId, widgetId, url, name, onCapabilities }: Props = $props();

  const core = useCoreClient();
    let iframeUrl = $state<string | null>(null);
  let authFailed = $state(false);

  $effect(() => {
    const originalUrl = url;
    const currentRoomId = roomId;

    let parsed: URL;

    try {
      parsed = new URL(originalUrl);
    } catch {
      iframeUrl = originalUrl;
      return;
    }

    // Only provide a token to the trusted Scalar Jitsi widget.
    if (
      parsed.origin !== 'https://scalar.vector.im' ||
      parsed.pathname !== '/api/widgets/jitsi.html'
    ) {
      iframeUrl = originalUrl;
      return;
    }

    iframeUrl = null;
    authFailed = false;

    let active = true;

    void core.rpc.session
      .integrationManagerUrl({ room_id: currentRoomId })
      .then((managerUrl) => {
        if (!active) return;

        const manager = new URL(managerUrl);

        if (manager.origin !== 'https://scalar.vector.im') {
          throw new Error('Unexpected integration manager origin');
        }

        const token = manager.searchParams.get('scalar_token');

        if (!token) {
          throw new Error('Missing Scalar token');
        }

        parsed.searchParams.set('scalar_token', token);
        iframeUrl = parsed.toString();
      })
      .catch(() => {
        if (active) {
          authFailed = true;
          console.warn('[sable widgets] Scalar Jitsi authentication failed');
        }
      });

    return () => {
      active = false;
    };
  });

  function widget(node: HTMLIFrameElement) {
    const definition = untrack(() => ({
      id: widgetId,
      creatorUserId: core.session?.user_id ?? '',
      type: 'm.custom',
      url: node.src,
      waitForIframeLoad: true,
    }));
    const room = untrack(() => roomId);
    const approve = untrack(() => onCapabilities);

    if (!node.contentWindow) return;

    const driver = new SableWidgetDriver(core, room, approve, (permalink) =>
      goto(resolve('/(app)/to/[...permalink]', { permalink }))
    );
    const api = new ClientWidgetApi(new Widget(definition), node, driver);
    api.setViewedRoomId(room);
    core.rpc.session
      .knownRooms()
      .then((roomIds) => driver.noteRooms(roomIds))
      .catch((error: unknown) => {
        console.warn('[sable widgets] listing known rooms failed', error);
      });
    const stopFeed = startWidgetFeed(core, api, driver);

    const onReady = (): void => {
      api.updateVisibility(true).catch((error: unknown) => {
        console.debug('[sable widgets] the widget visibility could not be updated', error);
      });
    };
    api.once('ready', onReady);

    return () => {
      stopFeed();
      api.off('ready', onReady);
      api.stop();
    };
  }
</script>

{#if iframeUrl}
  <iframe
  class="widget-frame"
  title={name}
  src={iframeUrl}
  allow="autoplay; camera; clipboard-read; clipboard-write; compute-pressure; display-capture; encrypted-media; fullscreen; hid; microphone; screen-wake-lock"
  sandbox="allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-downloads"
  {@attach widget}
></iframe>
{:else}
  <p>
    {authFailed
      ? 'Scalar 认证失败，无法打开 Jitsi 组件。'
      : '正在验证 Jitsi 组件…'}
  </p>
{/if}

<style>
  .widget-frame {
    background: var(--surface-container);
    border: 0;
    border-radius: var(--radius);
    display: block;
    height: 100%;
    width: 100%;
  }
</style>
