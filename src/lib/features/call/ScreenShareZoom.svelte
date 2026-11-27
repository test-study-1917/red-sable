<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { on } from 'svelte/events';

  import { clamp } from '#lib/clamp.js';
  import { i18n } from '#lib/i18n.js';
  import { clampPan, type Size, type Vector2 } from '#lib/ui/pan-clamp.js';
  import Slider from '#lib/ui/primitives/Slider.svelte';
  import { wheelZoomFactor } from '#lib/ui/wheel-zoom.js';

  let {
    attachVideo,
    controlsOpen,
  }: {
    attachVideo: Attachment<HTMLVideoElement>;
    controlsOpen: boolean;
  } = $props();

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  let zoom = $state(MIN_ZOOM);
  let width = $state(0);
  let height = $state(0);
  let videoSize = $state.raw<Size>({ width: 0, height: 0 });
  let pan = $state.raw<Vector2>({ x: 0, y: 0 });
  let drag = $state.raw<{ pointerId: number; x: number; y: number }>();
  let fit = $derived.by(() => {
    if (videoSize.width === 0 || videoSize.height === 0) return { width, height };
    const factor = Math.min(width / videoSize.width, height / videoSize.height);
    return { width: videoSize.width * factor, height: videoSize.height * factor };
  });
  let offset = $derived(
    clampPan(pan, { width, height }, { width: fit.width * zoom, height: fit.height * zoom })
  );
  let percent = $derived(Math.round(zoom * 100));

  function measureVideo(event: Event & { currentTarget: HTMLVideoElement }): void {
    videoSize = { width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight };
  }

  function setZoom(next: number, anchor: Vector2 = { x: 0, y: 0 }): void {
    const scale = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (scale === zoom) return;
    const ratio = scale / zoom;
    pan = {
      x: anchor.x + (offset.x - anchor.x) * ratio,
      y: anchor.y + (offset.y - anchor.y) * ratio,
    };
    zoom = scale;
  }

  function zoomGestures(viewport: HTMLElement) {
    function zoomAt(event: MouseEvent, factor: number): void {
      const box = viewport.getBoundingClientRect();
      setZoom(zoom * factor, {
        x: event.clientX - box.left - box.width / 2,
        y: event.clientY - box.top - box.height / 2,
      });
    }

    let gestureScale = 1;
    const listeners = [
      on(
        viewport,
        'wheel',
        (event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          zoomAt(event, wheelZoomFactor(event, event.deltaY, height));
        },
        { passive: false }
      ),
      on(viewport, 'gesturestart', (event) => {
        event.preventDefault();
        gestureScale = 1;
      }),
      on(viewport, 'gesturechange', (event) => {
        event.preventDefault();
        const gesture = event as MouseEvent & { scale: number };
        zoomAt(gesture, gesture.scale / gestureScale);
        gestureScale = gesture.scale;
      }),
      on(viewport, 'pointerdown', startDrag),
      on(viewport, 'pointermove', moveDrag),
      on(viewport, 'lostpointercapture', endDrag),
    ];
    return () => {
      for (const stop of listeners) stop();
    };
  }

  function startDrag(event: PointerEvent & { currentTarget: HTMLElement }): void {
    if (event.button !== 0 || zoom === MIN_ZOOM || drag) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function moveDrag(event: PointerEvent): void {
    if (drag?.pointerId !== event.pointerId) return;
    pan = { x: offset.x + event.clientX - drag.x, y: offset.y + event.clientY - drag.y };
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function endDrag(event: PointerEvent): void {
    if (drag?.pointerId === event.pointerId) drag = undefined;
  }
</script>

<div
  class="screen-share-viewport"
  class:pannable={zoom > MIN_ZOOM}
  class:dragging={drag !== undefined}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {@attach zoomGestures}
>
  <video
    autoplay
    muted
    playsinline
    draggable="false"
    style:transform={`translate(${String(offset.x)}px, ${String(offset.y)}px) scale(${String(zoom)})`}
    onloadedmetadata={measureVideo}
    onresize={measureVideo}
    {@attach attachVideo}
  ></video>
</div>

{#if controlsOpen}
  <div class="zoom-controls">
    <Slider
      min={MIN_ZOOM * 100}
      max={MAX_ZOOM * 100}
      step={1}
      label={i18n.t('call.screenZoomLevel')}
      value={percent}
      oninput={(value) => setZoom(value / 100)}
    />
    <span class="percent">{percent}%</span>
  </div>
{/if}

<style>
  .screen-share-viewport {
    inset: 0;
    overflow: hidden;
    position: absolute;
  }

  .pannable {
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .dragging {
    cursor: grabbing;
  }

  video {
    block-size: 100%;
    display: block;
    inline-size: 100%;
    object-fit: contain;
  }

  .zoom-controls {
    align-items: center;
    background: var(--bg-container);
    border: var(--border-width) solid var(--bg-container-line);
    border-radius: var(--radii-300);
    box-shadow: var(--shadow-float);
    box-sizing: border-box;
    color: var(--bg-on-container);
    display: flex;
    gap: var(--space-150);
    inline-size: min(14rem, calc(100% - var(--space-400)));
    inset: calc(var(--space-200) + var(--control-height-300) + var(--space-100)) var(--space-200)
      auto auto;
    padding: var(--space-150) var(--space-200);
    position: absolute;
  }

  .percent {
    flex: none;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    inline-size: 2.5rem;
    text-align: end;
  }
</style>
