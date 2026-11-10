import { expect, test, type Page } from '@playwright/test';
import { nextFrames } from './fixtures/settle';

const entry = '/tests/e2e/fixtures/call-termination.html?dual';
const layout = (page: Page) => page.locator('.room-call-layout');
async function open(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(entry);
  await expect(page.getByRole('button', { name: 'Hang up', exact: true })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toBeVisible();
}
async function turn(page: Page) {
  await page.getByRole('button', { name: /Place chat (below|beside) call/ }).click();
}
async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (s: string) => {
      const node = document.querySelector(s);
      if (!node) throw new Error(`Missing ${s}`);
      const { x, y, width, height, top, bottom, left, right } = node.getBoundingClientRect();
      return { x, y, width, height, top, bottom, left, right };
    };
    return {
      call: rect('.call-host'),
      chat: rect('.chat-host'),
      dock: rect('.dock'),
      top: rect('.top'),
      composer: rect('.composer-dock'),
      width: innerWidth,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Ordinary room starts without the optional members panel for deterministic column widths.
    if (!sessionStorage.getItem('dual-initialized')) {
      localStorage.clear();
      localStorage.setItem('sable-members-open', 'false');
      sessionStorage.setItem('dual-initialized', 'true');
    }
  });
});

test('actual RoomView: stable call, editor, reply and historical anchor across both axes', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'side-by-side');
  await page.screenshot({ path: info.outputPath('wide.png') });
  await page.locator('.ProseMirror').fill('A draft that must survive');
  await page.locator('.viewport').evaluate((n) => {
    n.scrollTop -= 2000;
  });
  await page.locator('.viewport').dispatchEvent('scrollend');
  await nextFrames(page);
  const anchor = await page.locator('.viewport').evaluate((n) => {
    const bounds = n.getBoundingClientRect();
    return [...n.querySelectorAll<HTMLElement>('.item[data-event-id]')].find(
      (row) => row.getBoundingClientRect().top >= bounds.top
    )?.dataset.eventId;
  });
  expect(anchor).toBeTruthy();
  const row = page.locator(`.item[data-event-id="${anchor}"]`);
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click();
  await page.locator('.ProseMirror').fill('A reply draft that must survive');
  // Record identities after lazy imports have completed.
  await page.evaluate(() => {
    Object.assign(window, {
      stableNodes: ['.call-stage', '.stage', '.chat-host', '.viewport', '.ProseMirror'].map((s) =>
        document.querySelector(s)
      ),
    });
  });
  await page.getByRole('button', { name: 'Turn camera on' }).click();
  await page.getByRole('button', { name: 'Deafen', exact: true }).click();
  const pin = page.getByRole('button', { name: 'Pin @other:example.org', exact: true });
  await page.locator('.tile').filter({ has: pin }).hover();
  await pin.click();
  const probe = () =>
    page.evaluate(() => (window as unknown as { dualProbe: () => unknown }).dualProbe());
  await page.evaluate(() => {
    (window as unknown as { dualWatch: () => void }).dualWatch();
  });
  const before = await probe();
  for (let n = 0; n < 4; n++) await turn(page);
  expect(await probe()).toEqual(before);
  expect(
    await page.evaluate(() => {
      const nodes = (window as unknown as { stableNodes: Element[] }).stableNodes;
      return ['.call-stage', '.stage', '.chat-host', '.viewport', '.ProseMirror'].every(
        (s, n) => document.querySelector(s) === nodes[n]
      );
    })
  ).toBe(true);
  await expect(page.locator('.ProseMirror')).toContainText('A reply draft that must survive');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(row).toBeInViewport();
  await turn(page);
  await expect(row).toBeInViewport();
  await page.screenshot({ path: info.outputPath('stacked.png') });
  expect(errors).toEqual([]);
});

test('actual side panels, threshold hysteresis and temporary fallback preserve preference', async ({
  page,
}) => {
  await open(page, 1150, 768);
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'side-by-side');
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  const memberHandle = page.getByRole('slider', { name: 'Members', exact: true });
  await memberHandle.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'stacked');
  await page.getByRole('button', { name: 'Close members', exact: true }).click();
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'side-by-side');
  for (const [width, expected] of [
    [775, 'stacked'],
    [790, 'stacked'],
    [800, 'side-by-side'],
    [780, 'side-by-side'],
    [775, 'stacked'],
  ] as const) {
    await page.setViewportSize({ width, height: 768 });
    await expect(layout(page)).toHaveAttribute('data-call-layout', expected);
  }
  expect(await page.evaluate(() => localStorage.getItem('sable-call-chat-layout'))).toBeNull();
  await page.setViewportSize({ width: 1024, height: 768 });
  await turn(page);
  await page.reload();
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'stacked');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'stacked');
});

test('mouse, directional keyboard and Shift resize persist independently', async ({ page }) => {
  await open(page);
  const handle = page.getByRole('slider', { name: 'Resize call' });
  await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('separator missing');
  await page.mouse.move(bounds.x + 4, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 100, bounds.y + 100);
  await page.mouse.up();
  const dragged = await geometry(page);
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  expect((await geometry(page)).call.width).toBeGreaterThan(dragged.call.width);
  await page.keyboard.press('Shift+ArrowLeft');
  const beside = await geometry(page);
  await turn(page);
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
  const horizontal = await handle.boundingBox();
  if (!horizontal) throw new Error('separator missing');
  await page.mouse.move(horizontal.x + 100, horizontal.y + 4);
  await page.mouse.down();
  await page.mouse.move(horizontal.x + 100, horizontal.y + 70);
  await page.mouse.up();
  await handle.focus();
  await page.keyboard.press('Shift+ArrowDown');
  const stacked = await geometry(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Hang up', exact: true })).toBeVisible();
  expect((await geometry(page)).call.height).toBeCloseTo(stacked.call.height, 0);
  await turn(page);
  expect((await geometry(page)).call.width).toBeCloseTo(beside.call.width, 0);
});

test('narrow, short and wrapping controls leave composer usable; menus and notices stay visible', async ({
  page,
}, info) => {
  await open(page, 390, 844);
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'stacked');
  const unavailable = page.getByRole('button', { name: /Not enough space/ });
  await expect(unavailable).toHaveAttribute('aria-disabled', 'true');
  await unavailable.focus();
  await page.screenshot({ path: info.outputPath('narrow.png') });
  for (const [width, height] of [
    [900, 500],
    [390, 500],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await nextFrames(page);
    const g = await geometry(page);
    expect(g.overflow).toBe(false);
    expect(g.composer.bottom).toBeLessThanOrEqual(height + 1);
    expect(g.dock.top).toBeGreaterThanOrEqual(g.top.bottom);
    expect(g.dock.bottom).toBeLessThanOrEqual(g.call.bottom + 1);
  }
  await page.setViewportSize({ width: 900, height: 500 });
  await page.screenshot({ path: info.outputPath('short.png') });
  await page.setViewportSize({ width: 1000, height: 768 });
  await page.getByRole('slider', { name: 'Resize call' }).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Call ending options' }).click();
  await expect(page.getByRole('menuitem', { name: 'End call for everyone' })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('wrapped-menu.png') });
  await page.getByRole('menuitem', { name: 'End call for everyone' }).click();
  await expect(page.getByRole('dialog')).toBeInViewport();
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not confirm');
  await page.screenshot({ path: info.outputPath('notice.png') });
  await page.setViewportSize({ width: 390, height: 500 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const notices = document.querySelector('.notices');
        const dock = document.querySelector('.dock');
        if (!notices || !dock) throw new Error('Missing call chrome');
        return notices.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top + 1;
      })
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Retry', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('short-notice.png') });
});

test('fullscreen hides the layout action, restores hosts and responds to resized space', async ({
  page,
}) => {
  await open(page);
  const before = await geometry(page);
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(page.getByRole('button', { name: /Place chat/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'side-by-side');
  expect((await geometry(page)).call.width).toBeCloseTo(before.call.width, 0);
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 700,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'stacked');
});

test('voice room keeps its main call and optional right chat; no-call ordinary room fills content', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.callTerminationProbe.remoteEnd();
  });
  await expect(page.locator('.call-host')).toHaveCount(0);
  const g = await page.locator('.chat-host').boundingBox();
  expect(g?.width).toBe(1440);
  await page.goto(entry + '&voice');
  await expect(page.getByRole('button', { name: 'Hang up', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Place chat/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show chat', exact: true }).click();
  await expect(page.locator('.voice-chat')).toBeVisible();
  await expect(page.locator('.voice-chat .ProseMirror')).toBeVisible();
  await page.evaluate(() => {
    window.callTerminationProbe.remoteEnd();
  });
  await expect(page.locator('.lobby')).toBeVisible();
});

test('live arrivals follow bottom after switching; edit context keeps its editor and focus', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await turn(page);
  await page.evaluate(() => {
    (window as unknown as { appendDualMessage: () => void }).appendDualMessage();
  });
  await expect(page.locator('.item[data-event-id="$arrival:example.test"]')).toBeInViewport();
  await turn(page);
  await expect(page.locator('.item[data-event-id="$arrival:example.test"]')).toBeInViewport();
  const own = page.locator('.item[data-event-id="$dual-149:example.test"]');
  await own.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit message', exact: true }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toContainText('Message 149');
  await editor.fill('Edited draft still here');
  await turn(page);
  await turn(page);
  await expect(editor).toContainText('Edited draft still here');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await editor.focus();
  await page.setViewportSize({ width: 700, height: 650 });
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'stacked');
  await expect(editor).toBeFocused();
  expect(errors).toEqual([]);
});

test('search and thread panels shrink the actual measured room content and restore it', async ({
  page,
}) => {
  await open(page, 1150, 768);
  await page.getByRole('button', { name: 'Search messages', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close search', exact: true })).toBeVisible();
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'stacked');
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'side-by-side');
  await page.locator('.item[data-event-id="$dual-149:example.test"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reply in thread', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close thread', exact: true })).toBeVisible();
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'stacked');
  await page.getByRole('button', { name: 'Close thread', exact: true }).click();
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'side-by-side');
});

test('connecting and failed calls still lay out without another join or stale dock space', async ({
  page,
}, info) => {
  await open(page, 1000, 768);
  await page.evaluate(() => {
    (window as unknown as { dualPhase: (phase: string) => void }).dualPhase('connecting');
  });
  await expect(page.locator('.securing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hang up', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('connecting.png') });
  await page.evaluate(() => {
    (window as unknown as { dualPhase: (phase: string) => void }).dualPhase('failed');
  });
  await expect(page.locator('.media > .failed')).toBeVisible();
  await expect(page.locator('.dock')).toHaveCount(0);
  expect(await page.locator('.media').evaluate((n) => getComputedStyle(n).paddingBottom)).toBe(
    '0px'
  );
  await turn(page);
  await expect(layout(page)).toHaveAttribute('data-call-layout', 'stacked');
  expect(
    await page.evaluate(
      () => (window as unknown as { dualProbe: () => { joins: number } }).dualProbe().joins
    )
  ).toBe(1);
  await page.screenshot({ path: info.outputPath('failed.png') });
});
