import { expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { expectNoA11yViolations } from '#lib/test-support/a11y.js';

import CallEndHarness from './CallEndHarness.test.svelte';

for (const { name, width, compact, collapsed } of [
  { name: 'main call', width: 1200, compact: false, collapsed: false },
  { name: 'narrow main call', width: 690, compact: false, collapsed: false },
  { name: 'mobile-width main call', width: 390, compact: false, collapsed: false },
  { name: 'compact bar', width: 1200, compact: true, collapsed: false },
  { name: 'collapsed bar', width: 1200, compact: true, collapsed: true },
]) {
  test(`${name}: confirm, failure, retry and ordinary leave remain usable`, async () => {
    await page.viewport(width, 800);
    const onEnd = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('send failed'));
    const onLeave = vi.fn();
    const screen = await render(CallEndHarness, { compact, collapsed, onEnd, onLeave });

    const options = screen.getByRole('button', { name: 'Call ending options' });
    await userEvent.click(options);
    const menu = screen.getByRole('menu');
    await expect.element(menu).toBeVisible();
    const menuBox = menu.element().getBoundingClientRect();
    expect(menuBox.left).toBeGreaterThanOrEqual(0);
    expect(menuBox.right).toBeLessThanOrEqual(width);
    await userEvent.click(screen.getByRole('menuitem', { name: 'End call for everyone' }));
    const dialog = screen.getByRole('dialog', { name: 'End the call for everyone?' });
    await expect.element(dialog).toBeVisible();
    expect(onEnd).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEnd).not.toHaveBeenCalled();

    await userEvent.click(options);
    await userEvent.click(screen.getByRole('menuitem', { name: 'End call for everyone' }));
    await userEvent.click(screen.getByRole('button', { name: 'End call', exact: true }));
    await expect.element(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('alert').element().textContent).toContain(
      collapsed ? 'End not confirmed' : 'Could not confirm the end-call notification was sent.'
    );
    expect(onEnd).toHaveBeenCalledOnce();
    await expectNoA11yViolations(document.body);

    const alert = screen.getByRole('alert').element();
    const box = alert.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width);
    if (compact) {
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
      if (!sidebar) throw new Error('missing sidebar');
      expect(box.right).toBeLessThanOrEqual(sidebar.right);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await expect.poll(() => onEnd.mock.calls.length).toBe(2);
    await userEvent.click(
      screen.getByRole('button', { name: collapsed ? 'Hang up' : 'Leave call' })
    );
    expect(onLeave).toHaveBeenCalledOnce();
  });
}

test('the ending menu and confirmation can be operated with the keyboard', async () => {
  await page.viewport(1200, 800);
  const onEnd = vi.fn<() => Promise<void>>().mockResolvedValue();
  const screen = await render(CallEndHarness, { onEnd, onLeave: vi.fn() });
  const options = screen.getByRole('button', { name: 'Call ending options' });
  (options.element() as HTMLButtonElement).focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(screen.getByRole('menu')).toBeVisible();
  await userEvent.keyboard('{End}');
  expect(document.activeElement?.textContent).toContain('End call for everyone');
  await userEvent.keyboard('{Enter}');
  const dialog = screen.getByRole('dialog', { name: 'End the call for everyone?' });
  await expect.element(dialog).toBeVisible();
  expect(dialog.element().contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.textContent).toContain('Cancel');
  await userEvent.keyboard('{Escape}');
  await expect.element(dialog).not.toBeInTheDocument();
  expect(onEnd).not.toHaveBeenCalled();
});

for (const compact of [false, true]) {
  test(`sending prevents another request but permits leaving (${compact ? 'bar' : 'main view'})`, async () => {
    await page.viewport(1200, 800);
    let release!: () => void;
    const onEnd = vi.fn<() => Promise<void>>(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    const onLeave = vi.fn();
    const screen = await render(CallEndHarness, { compact, onEnd, onLeave });
    await userEvent.click(screen.getByRole('button', { name: 'Call ending options' }));
    if (!compact) {
      const stage = document.querySelector('.stage');
      const dock = document.querySelector('.dock');
      if (!stage || !dock) throw new Error('missing call stage');
      stage.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
      expect(stage.classList.contains('resting')).toBe(false);
      expect(getComputedStyle(dock).opacity).toBe('1');
      await expect.element(screen.getByRole('menu')).toBeVisible();
    }
    await userEvent.click(screen.getByRole('menuitem', { name: 'End call for everyone' }));
    await userEvent.click(screen.getByRole('button', { name: 'End call', exact: true }));
    await expect.element(screen.getByText('Sending end-call notification…')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Call ending options' }));
    await expect
      .element(screen.getByRole('menuitem', { name: 'End call for everyone' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(onEnd).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Leave call' }));
    expect(onLeave).toHaveBeenCalledOnce();
    release();
  });
}
