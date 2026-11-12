// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';

import { copyText } from '#lib/platform/clipboard.js';

import { selectedText, withSelectedText } from './timeline-item-selection';

vi.mock('#lib/platform/clipboard.js', () => ({ copyText: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function row(text: string): HTMLElement {
  const node = document.createElement('article');
  node.textContent = text;
  document.body.append(node);
  return node;
}

function select(node: Node, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

test('reads a selection made inside the row', () => {
  const message = row('hello world');
  select(message.firstChild as Node, 0, 5);
  expect(selectedText(message)).toBe('hello');
});

test('ignores a collapsed selection, a missing row and a selection elsewhere', () => {
  const message = row('hello world');
  const other = row('elsewhere');
  select(message.firstChild as Node, 2, 2);
  expect(selectedText(message)).toBe('');
  select(other.firstChild as Node, 0, 4);
  expect(selectedText(message)).toBe('');
  expect(selectedText(null)).toBe('');
});

test('only offers copying the selection when there is one', () => {
  const base = { onReply: vi.fn() };
  expect(withSelectedText(base, '')).toBe(base);

  const actions = withSelectedText(base, 'hello');
  expect(actions.onReply).toBe(base.onReply);
  expect(actions.copyTextLabel).toBe('timeline.copySelection');
  actions.onCopyText?.();
  expect(copyText).toHaveBeenCalledWith('hello');
});

test('captures only message body text and keeps the exact repeated occurrence', async () => {
  const { selectedQuote } = await import('./timeline-item-selection');
  const message = document.createElement('article');
  message.innerHTML =
    '<header>Alice</header><div class="formatted-body">hello <b>hello</b> world</div>';
  document.body.append(message);
  select(message.querySelector('b')?.firstChild as Node, 0, 5);
  expect(selectedQuote(message)).toEqual({
    body: 'hello hello world',
    text: 'hello',
    start: 6,
    end: 11,
  });
  select(message.querySelector('header')?.firstChild as Node, 0, 5);
  expect(selectedQuote(message)).toBeNull();
});

test('captures selections across formatting and line breaks', async () => {
  const { selectedQuote } = await import('./timeline-item-selection');
  const message = document.createElement('article');
  message.innerHTML = '<div class="formatted-body"><p>你好 <b>world</b></p><p>next 😀</p></div>';
  document.body.append(message);
  const range = document.createRange();
  range.setStart(message.querySelector('b')?.firstChild as Node, 0);
  range.setEnd(message.querySelectorAll('p')[1].firstChild as Node, 7);
  getSelection()?.addRange(range);
  expect(selectedQuote(message)).toEqual({
    body: '你好 world\nnext 😀',
    text: 'world\nnext 😀',
    start: 3,
    end: 16,
  });
});

test('does not expose hidden spoilers in a reply snapshot', async () => {
  const { selectedQuote } = await import('./timeline-item-selection');
  const message = document.createElement('article');
  message.innerHTML =
    '<div class="formatted-body"><span data-mx-spoiler>secret</span> public</div>';
  document.body.append(message);
  select(message.querySelector('.formatted-body')?.lastChild as Node, 1, 7);
  expect(selectedQuote(message)).toEqual({
    body: '[Spoiler] public',
    text: 'public',
    start: 10,
    end: 16,
  });
  select(message.querySelector('[data-mx-spoiler]')?.firstChild as Node, 0, 6);
  expect(selectedQuote(message)).toBeNull();
});
