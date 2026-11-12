// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { quoteFocus, revealQuote, setQuoteFocus } from './quote-focus.svelte.js';

const body = 'First passage. Second passage.';
const first = {
  roomId: '!room:example.org',
  eventId: '$source',
  quote: { body, text: 'First', start: 0, end: 5 },
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  setQuoteFocus(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('expires the quote target after exactly one minute', () => {
  setQuoteFocus(first);
  vi.advanceTimersByTime(59_999);
  expect(quoteFocus.target?.quote.text).toBe('First');
  vi.advanceTimersByTime(1);
  expect(quoteFocus.target).toBeNull();
});

test('moving to a new passage restarts the minute and cancels the old expiry', () => {
  setQuoteFocus(first);
  vi.advanceTimersByTime(58_000);
  setQuoteFocus({ ...first, quote: { body, text: 'Second', start: 15, end: 21 } });
  vi.advanceTimersByTime(2_000);
  expect(quoteFocus.target?.quote.text).toBe('Second');
  vi.advanceTimersByTime(57_999);
  expect(quoteFocus.target).not.toBeNull();
  vi.advanceTimersByTime(1);
  expect(quoteFocus.target).toBeNull();
});

test('clicking the same quote again also restarts its lifetime', () => {
  setQuoteFocus(first);
  const previous = quoteFocus.target;
  vi.advanceTimersByTime(59_000);
  setQuoteFocus(first);
  expect(quoteFocus.target).not.toBe(previous);
  expect(quoteFocus.target?.startedAt).toBe(Date.now());
  vi.advanceTimersByTime(1_000);
  expect(quoteFocus.target).not.toBeNull();
  vi.advanceTimersByTime(59_000);
  expect(quoteFocus.target).toBeNull();
});

test('all marked text nodes resume the last-five-second fade without scrolling again', () => {
  setQuoteFocus(first);
  const target = quoteFocus.target;
  if (!target) throw new Error('missing quote target');
  const root = document.createElement('div');
  root.innerHTML = '<mark>First</mark><strong><mark>passage</mark></strong>';
  const marks = root.querySelectorAll<HTMLElement>('mark');
  const animate = vi.spyOn(HTMLElement.prototype, 'animate');
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  const stop = revealQuote(target, marks);
  expect(scroll).toHaveBeenCalledOnce();
  stop();
  vi.advanceTimersByTime(58_000);
  const stopAgain = revealQuote(target, marks);
  expect(scroll).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenCalledTimes(4);
  for (const call of animate.mock.calls) {
    expect(call[1]).toEqual({ duration: 5_000, delay: 55_000, easing: 'linear', fill: 'forwards' });
  }
  const resumed = animate.mock.results.slice(2).map((result) => result.value as Animation);
  const cancels = resumed.map((animation) => {
    expect(animation.currentTime).toBe(58_000);
    return vi.spyOn(animation, 'cancel');
  });
  stopAgain();
  for (const cancel of cancels) expect(cancel).toHaveBeenCalledOnce();
});
