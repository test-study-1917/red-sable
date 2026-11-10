<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { CoreEvent } from '#src/generated/protocol';
  import type { CoreClient } from '#lib/core/client.svelte.js';
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import ActiveCallBar from '#lib/features/call/ActiveCallBar.svelte';
  import CallDualRoom from './call-dual-room.svelte';
  import CallView from '#lib/features/call/CallView.svelte';
  import {
    CallSession,
    provideCallSession,
    type CallTermination,
  } from '#lib/features/call/call-session.svelte.js';
  import {
    idleTransportState,
    type CallTransport,
    type CallTransportState,
  } from '#lib/features/call/call-transport.js';

  type Probe = {
    joins: number;
    connects: number;
    sends: number;
    leaves: number;
    disconnects: number;
    fail: boolean;
    ended: CallTermination[];
    remoteEnd: () => void;
  };
  const probe: Probe = {
    joins: 0,
    connects: 0,
    sends: 0,
    leaves: 0,
    disconnects: 0,
    fail: true,
    ended: [],
    remoteEnd: () => {},
  };
  const listeners = new SvelteSet<(event: CoreEvent) => void>();
  const emit = (event: CoreEvent) => listeners.forEach((listener) => listener(event));
  const termination = (local: boolean): Extract<CoreEvent, { type: 'call_terminated' }> => ({
    type: 'call_terminated',
    session: 7,
    room_id: '!room:example.org',
    terminated_by: local ? '@me:example.org' : '@other:example.org',
    event_id: '$end:example.org',
    local,
  });
  probe.remoteEnd = () => emit(termination(false));
  const client = {
    rpc: {
      calls: {
        join: () => {
          probe.joins += 1;
          return Promise.resolve({
            session: 7,
            url: 'wss://unused.example.org',
            jwt: 'unused',
            identity: '@me:example.org:LAPTOP',
            encrypt_media: false,
            mode: 'legacy',
            mode_reason: 'fresh',
            sticky_available: false,
            peer_modes: [],
            can_publish: true,
            publisher_id: 'legacy',
            backends: [],
          });
        },
        leave: () => {
          probe.leaves += 1;
          return Promise.resolve();
        },
        setScreenSharing: () => Promise.resolve(),
        endForEveryone: () => {
          probe.sends += 1;
          if (probe.fail) return Promise.reject(new Error('send failed'));
          queueMicrotask(() => emit(termination(true)));
          return Promise.resolve();
        },
      },
    },
    subscribeEvents: (listener: (event: CoreEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as CoreClient;

  let transportState = idleTransportState();
  const transportListeners = new SvelteSet<(state: CallTransportState) => void>();
  const publish = () => transportListeners.forEach((listener) => listener(transportState));
  const transport: CallTransport = {
    connect: async () => {
      probe.connects += 1;
      transportState = {
        ...idleTransportState(),
        connection: 'connected',
        self: { identity: '@me:example.org:LAPTOP', local: true },
        participants: [{ identity: '@other:example.org:PHONE' }],
      };
      publish();
    },
    disconnect: async () => {
      probe.disconnects += 1;
      transportState = idleTransportState();
      publish();
    },
    setMicrophoneEnabled: async (enabled) => {
      transportState = { ...transportState, microphoneEnabled: enabled };
      publish();
    },
    setCameraEnabled: async (enabled) => {
      transportState = { ...transportState, cameraEnabled: enabled };
      publish();
    },
    setEncryptionKey: async () => {},
    subscribe: (listener) => {
      transportListeners.add(listener);
      listener(transportState);
      return () => transportListeners.delete(listener);
    },
    getState: () => transportState,
    capabilities: {},
  };
  const session = new CallSession(client, {
    createTransport: () => transport,
    onTerminated: (event) => {
      probe.ended.push(event);
    },
  });
  provideCallSession(session);
  let { dual = false, voice = false }: { dual?: boolean; voice?: boolean } = $props();
  let callNode: Element | null = null;
  let chatOriginal: Element | null = null;
  let compact = $state(false);
  let collapsed = $state(false);
  onMount(() => {
    if (dual)
      Object.assign(window, {
        dualPhase: (phase: 'connecting' | 'failed') => {
          session.lifecycle = phase;
          session.failure = phase === 'failed' ? 'setup-failed' : null;
        },
        dualWatch: () => session.toggleWatchScreenShare('fixture-screen'),
        dualProbe: () => ({
          joins: probe.joins,
          connects: probe.connects,
          microphone: session.transport.microphoneEnabled,
          camera: session.transport.cameraEnabled,
          deafened: session.deafened,
          views: session.views,
          callStable:
            (callNode ??= document.querySelector('.call-stage')) ===
            document.querySelector('.call-stage'),
          chatStable:
            (chatOriginal ??= document.querySelector('.chat-host')) ===
            document.querySelector('.chat-host'),
          layout: session.layout,
          watched: session.watchedScreenShareIds,
          leaves: probe.leaves,
          disconnects: probe.disconnects,
        }),
      });
    window.callTerminationProbe = probe;
    void session.join('!room:example.org', { microphone: false, camera: false }).then(() => {
      emit({
        type: 'call_members',
        session: 7,
        members: [
          {
            user_id: '@me:example.org',
            device_id: 'LAPTOP',
            identity: '@me:example.org:LAPTOP',
            backend_id: null,
            joined_ts: Date.now(),
            screen_sharing: false,
          },
          {
            user_id: '@other:example.org',
            device_id: 'PHONE',
            identity: '@other:example.org:PHONE',
            backend_id: null,
            joined_ts: Date.now(),
            screen_sharing: false,
          },
        ],
      });
    });
  });
</script>

<TooltipProvider>
  {#if dual}
    <CallDualRoom callClient={client} {voice} />
  {:else}
    <button type="button" onclick={() => (compact = !compact)}>Switch view</button>
    {#if compact}
      <button type="button" onclick={() => (collapsed = !collapsed)}>Collapse sidebar</button>
    {/if}
    {#if session.active}
      {#if compact}
        <div class={['bar', { collapsed }]}>
          <ActiveCallBar
            {session}
            roomName="Test call"
            {collapsed}
            onReturn={() => (compact = false)}
          />
        </div>
      {:else}
        <div class="stage"><CallView {session} members={[]} /></div>
      {/if}
    {:else}
      <p role="status">Call idle</p>
    {/if}
  {/if}
</TooltipProvider>

<style>
  .stage {
    display: flex;
    height: 36rem;
    width: min(70rem, 100%);
  }

  .bar {
    width: 16rem;
  }

  .bar.collapsed {
    width: 5.5rem;
  }
</style>
