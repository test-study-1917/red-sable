import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

vi.mock('./call-telemetry', () => ({ CallTelemetry: vi.fn() }));

import type { CallSession } from './call-session.svelte.js';
import { idleTransportState } from './call-transport';
import CallViewHarness from './CallViewHarness.test.svelte';

afterEach(() => vi.restoreAllMocks());

function activeCall({
  onModerate,
  sharing = false,
  native = true,
}: {
  onModerate?: ReturnType<CallSession['participantControl']>;
  sharing?: boolean;
  native?: boolean;
} = {}): CallSession {
  const overlay = native
    ? { place: vi.fn(() => Promise.resolve()), clear: vi.fn(() => Promise.resolve()) }
    : undefined;
  const track = { id: 'camera', muted: false, subscribed: true };
  const screenShare = sharing ? { ...track, id: 'screen' } : undefined;
  return {
    lifecycle: 'active',
    mediaReady: true,
    failure: null,
    deviceError: null,
    startedAt: null,
    layout: { pinned: null, gridForced: false },
    watchedScreenShareIds: screenShare ? [screenShare.id] : [],
    views: 0,
    deafened: false,
    microphoneEnabled: true,
    inputMode: 'voice-activity',
    encryptsMedia: false,
    canScreenShare: true,
    canSwitchCamera: true,
    audioRoutes: { list: () => Promise.resolve([]), select: () => Promise.resolve() },
    localVideo: overlay,
    remoteVideo: overlay,
    rooms: [],
    members: [],
    transport: {
      ...idleTransportState(),
      connection: 'connected',
      microphoneEnabled: true,
      self: { identity: 'me', local: true },
      participants: [{ identity: 'bob', camera: track, microphone: track, screenShare }],
    },
    roomFor: () => undefined,
    participantControl: () => onModerate,
  } as unknown as CallSession;
}

async function renderCall(session = activeCall(), splitChat = false) {
  const screen = await render(CallViewHarness, {
    session,
    members: [],
    onOpenSettings: vi.fn(),
    splitChat,
  });
  screen.container.style.cssText = 'display:flex;width:402px;height:700px';
  return screen;
}

test('the wrapped controls dock floats inside the stage without reserving space below the video', async () => {
  await page.viewport(402, 874);
  const { container } = await renderCall();
  const stage = container.querySelector<HTMLElement>('.stage');
  const controls = container.querySelector<HTMLElement>('.dock .controls');
  const video = container.querySelector<HTMLElement>('.tile .video');
  if (!stage || !controls || !video) throw new Error('call not rendered');

  await expect.poll(() => video.getBoundingClientRect().height).toBeGreaterThan(0);
  const stageBox = stage.getBoundingClientRect();
  const controlsBox = controls.getBoundingClientRect();
  expect(controlsBox.left).toBeGreaterThanOrEqual(stageBox.left);
  expect(controlsBox.right).toBeLessThanOrEqual(stageBox.right);
  expect(controlsBox.bottom).toBeLessThanOrEqual(stageBox.bottom);
  expect(video.getBoundingClientRect().bottom).toBeGreaterThan(controlsBox.top);
});

test.for(['grid', 'strip'] as const)('the arrow above the %s toggles avatars', async (layout) => {
  await page.viewport(1200, 800);
  const screen = await renderCall(activeCall({ sharing: layout === 'strip' }));
  screen.container.style.width = '980px';
  expect(screen.container.querySelector('.tile .avatar-root')).toBeVisible();

  const hide = screen.getByRole('button', { name: 'Hide avatars' });
  expect(hide.element().closest(`.participant-${layout}`)).toBeInTheDocument();
  await userEvent.click(hide);
  expect(screen.container.querySelector('.tile .avatar-root')).not.toBeInTheDocument();
  await expect.element(screen.getByText('me', { exact: true })).toBeVisible();
  expect(screen.container.querySelector('.tile .video')).toBeVisible();

  await userEvent.click(screen.getByRole('button', { name: 'Show avatars' }));
  expect(screen.container.querySelector('.tile .avatar-root')).toBeVisible();
});

test('keeps the toolbar visible over the participant menu and removal confirmation', async () => {
  await page.viewport(1200, 800);
  const screen = await renderCall(activeCall({ onModerate: vi.fn() }));
  screen.container.style.width = '980px';
  const stage = screen.getByRole('region', { name: 'Call' });
  await userEvent.hover(stage.getByRole('listitem').nth(1));
  await userEvent.click(stage.getByRole('button', { name: 'Call controls for bob' }));

  const onLeave = vi.fn();
  stage.element().addEventListener('pointerleave', onLeave);
  await userEvent.hover(screen.getByRole('menuitem', { name: 'Turn off bob’s microphone' }));
  expect(onLeave).toHaveBeenCalled();
  await expect.element(stage).not.toHaveClass('resting');

  const remove = screen.getByRole('menuitem', { name: 'Remove bob from call' });
  await userEvent.hover(remove);
  await expect.element(stage).not.toHaveClass('resting');
  await userEvent.click(remove);
  const dialog = screen.getByRole('dialog', { name: 'Remove bob from this call?' });
  await expect.element(dialog).toBeVisible();
  stage.element().dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
  await expect.element(stage).not.toHaveClass('resting');

  await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  await expect.element(dialog).not.toBeInTheDocument();
  stage.element().dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
  await expect.element(stage).toHaveClass('resting');
});

test('zooms and pans the shared screen beside chat and keeps the zoom on resize', async ({
  onTestFinished,
}) => {
  await page.viewport(1280, 900);
  const screen = await renderCall(activeCall({ sharing: true, native: false }), true);
  screen.container.style.width = '1200px';
  const layout = screen.container.querySelector('.room-call-layout');
  const viewport = screen.container.querySelector<HTMLElement>('.screen-share-viewport');
  const video = viewport?.querySelector('video');
  if (!layout || !viewport || !video) throw new Error('Shared screen not rendered');
  await expect
    .element(page.elementLocator(layout))
    .toHaveAttribute('data-call-layout', 'side-by-side');

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const stream = canvas.captureStream();
  onTestFinished(() => stream.getTracks().forEach((track) => track.stop()));
  video.srcObject = stream;
  canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height);
  await expect.poll(() => video.videoWidth).toBe(canvas.width);

  const surface = page.elementLocator(viewport);
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  await userEvent.hover(surface, { position: { x: width / 2, y: height / 3 } });
  const toggle = screen.getByRole('button', { name: 'Screen share zoom', exact: true });
  await userEvent.click(toggle);
  const slider = screen.getByRole('slider', { name: 'Screen share zoom level' });
  await expect.element(slider).toHaveAttribute('aria-valuenow', '100');
  const sliderTrack = slider.element().closest<HTMLElement>('.slider');
  if (!sliderTrack) throw new Error('Zoom slider not rendered');
  await userEvent.dragAndDrop(slider, page.elementLocator(sliderTrack), {
    targetPosition: { x: sliderTrack.clientWidth / 2, y: sliderTrack.clientHeight / 2 },
  });
  const transform = () => new DOMMatrixReadOnly(getComputedStyle(video).transform);
  await expect.poll(() => transform().a).toBeGreaterThan(1);
  expect(getComputedStyle(viewport).cursor).toBe('grab');

  const initialZoom = transform().a;
  const box = viewport.getBoundingClientRect();
  const pinch = new WheelEvent('wheel', {
    ctrlKey: true,
    deltaY: -15,
    clientX: box.left + width * 0.6,
    clientY: box.top + height / 2,
    bubbles: true,
    cancelable: true,
  });
  viewport.dispatchEvent(pinch);
  expect(pinch.defaultPrevented).toBe(true);
  await expect.poll(() => transform().a).toBeGreaterThan(initialZoom);
  expect(transform().e).toBeLessThan(0);
  const beforeDrag = transform().e;
  await userEvent.dragAndDrop(surface, surface, {
    sourcePosition: { x: width / 2, y: height / 2 },
    targetPosition: { x: width / 2 + 70, y: height / 2 },
  });
  await expect.poll(() => transform().e).toBeGreaterThan(beforeDrag);

  const zoom = transform().a;
  await userEvent.click(screen.getByRole('slider', { name: 'Resize call' }));
  await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
  await expect.poll(() => viewport.clientWidth).toBeLessThan(width);
  expect(transform().a).toBe(zoom);

  await userEvent.click(screen.getByRole('button', { name: 'Place chat below call' }));
  await expect.element(page.elementLocator(layout)).toHaveAttribute('data-call-layout', 'stacked');
  expect(transform().a).toBe(zoom);
  await userEvent.click(screen.getByRole('button', { name: 'Place chat beside call' }));
  await expect
    .element(page.elementLocator(layout))
    .toHaveAttribute('data-call-layout', 'side-by-side');
  expect(transform().a).toBe(zoom);

  const chat = screen.getByRole('textbox', { name: 'Chat message' });
  expect(slider.element().getBoundingClientRect().right).toBeLessThan(
    chat.element().getBoundingClientRect().left
  );
  await userEvent.fill(chat, 'Chat stays usable while the screen is zoomed');
  await expect.element(chat).toHaveValue('Chat stays usable while the screen is zoomed');

  await userEvent.click(slider);
  await userEvent.keyboard('{Home}');
  await expect.poll(() => transform().isIdentity).toBe(true);
});
