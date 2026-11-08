<script lang="ts">
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import ActiveCallBar from './ActiveCallBar.svelte';
  import CallView from './CallView.svelte';
  import type { CallSession } from './call-session.svelte.js';
  import { idleTransportState } from './call-transport';

  interface Props {
    compact?: boolean;
    collapsed?: boolean;
    onEnd: () => Promise<void>;
    onLeave: () => void;
  }
  let { compact = false, collapsed = false, onEnd, onLeave }: Props = $props();
  const session = $state({
    lifecycle: 'active' as const,
    mediaReady: true,
    failure: null,
    deviceError: null,
    desktopShortcutStatus: 'inactive',
    endStatus: 'idle' as 'idle' | 'sending' | 'failed',
    canEndForEveryone: true,
    listenOnly: false,
    connectedAt: null,
    startedAt: null,
    layout: { pinned: null, gridForced: false },
    watchedScreenShareIds: [],
    views: 0,
    deafened: false,
    microphoneEnabled: false,
    inputMode: 'voice-activity',
    encryptsMedia: false,
    canScreenShare: false,
    canSwitchCamera: false,
    localVideo: undefined,
    remoteVideo: undefined,
    audioRoutes: undefined,
    audioInputs: undefined,
    rooms: [],
    members: [
      {
        user_id: '@here:example.org',
        device_id: 'LAPTOP',
        identity: '@here:example.org:LAPTOP',
        backend_id: null,
        joined_ts: 0,
        screen_sharing: false,
      },
      {
        user_id: '@other:example.org',
        device_id: 'PHONE',
        identity: '@other:example.org:PHONE',
        backend_id: null,
        joined_ts: 0,
        screen_sharing: false,
      },
    ],
    transport: {
      ...idleTransportState(),
      connection: 'connected' as const,
      self: { identity: '@here:example.org:LAPTOP', local: true },
      participants: [{ identity: '@other:example.org:PHONE' }],
    },
    roomFor: () => undefined,
    leave: () => onLeave(),
    endForEveryone: async () => {
      if (session.endStatus === 'sending') return;
      session.endStatus = 'sending';
      try {
        await onEnd();
      } catch {
        session.endStatus = 'failed';
      }
    },
    toggleMicrophone: () => {},
    setCameraEnabled: () => {},
    toggleScreenShare: () => {},
    setDeafened: () => {},
    toggleWatchScreenShare: () => {},
  });
</script>

<TooltipProvider>
  {#if compact}
    <div class:collapsed class="sidebar">
      <ActiveCallBar
        session={session as unknown as CallSession}
        roomName="Call room"
        {collapsed}
        onReturn={() => {}}
      />
    </div>
  {:else}
    <div class="main">
      <CallView session={session as unknown as CallSession} members={[]} />
    </div>
  {/if}
</TooltipProvider>

<style>
  .main {
    display: flex;
    height: 32rem;
    max-width: 100%;
    width: 70rem;
  }

  .sidebar {
    width: 16rem;
  }

  .sidebar.collapsed {
    width: 5.5rem;
  }
</style>
