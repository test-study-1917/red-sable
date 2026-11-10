<script lang="ts">
  import type { Snippet } from 'svelte';
  import { i18n } from '#lib/i18n.js';
  import ResizeHandle from '#lib/ui/primitives/ResizeHandle.svelte';
  import { RoomCallLayoutState } from './room-call-layout.svelte.js';
  let {
    active,
    docked,
    callStage,
    children,
  }: {
    active: boolean;
    docked: boolean;
    callStage: Snippet<[RoomCallLayoutState]>;
    children: Snippet;
  } = $props();
  const layout = new RoomCallLayoutState();
  function measure(node: HTMLElement) {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        layout.measure(
          node.clientWidth,
          node.clientHeight,
          Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
        );
      });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }
</script>

<div
  class={['room-call-layout', { beside: active && docked && layout.horizontal }]}
  data-call-layout={active && docked ? layout.layout : undefined}
  {@attach measure}
>
  {#if active}
    <div
      class={['call-host', { docked }]}
      style:flex-basis={docked ? `calc((100% - 8px) * ${layout.ratio})` : undefined}
    >
      {@render callStage(layout)}
    </div>
    {#if docked}
      <div class="divider">
        <ResizeHandle
          value={layout.ratio}
          min={layout.min}
          max={layout.max}
          label={i18n.t('call.resizeStage')}
          valueText={i18n.t('call.stageShare', { percent: Math.round(layout.ratio * 100) })}
          grow={layout.horizontal ? 'right' : 'down'}
          step={0.05}
          shiftStep={0.15}
          fromPixels={(pixels) => pixels / layout.extent}
          onResize={(value) => layout.resize(value)}
          onCommit={() => layout.size.commit()}
        />
      </div>
    {/if}
  {/if}
  <div class="chat-host">{@render children()}</div>
</div>

<style>
  .room-call-layout {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .room-call-layout.beside {
    flex-direction: row;
  }

  .call-host,
  .chat-host {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .call-host {
    flex-shrink: 0;
  }

  .call-host.docked {
    flex-grow: 0;
  }

  .chat-host:empty {
    display: none;
  }

  .divider {
    flex: 0 0 8px;
    position: relative;
  }

  .divider :global(.resize-handle) {
    height: 100%;
    inset: 0;
    width: 100%;
    z-index: 3;
  }

  .divider::before {
    background: var(--surface-container-line);
    content: '';
    inset: 3px calc(50% - 20px);
    position: absolute;
  }

  .beside .divider::before {
    inset: calc(50% - 20px) 3px;
  }
</style>
