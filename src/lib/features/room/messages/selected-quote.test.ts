// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { quoteDocument, quotePosition, markQuote, validQuote } from './selected-quote';

const body = 'First match. Second match. 最后 😀';
const quote = { body, text: 'match', start: 20, end: 25 };

test('stores offsets for the chosen occurrence, including Unicode', () => {
  expect(validQuote(quote)).toBe(true);
  expect(quotePosition(body, quote)).toBe(20);
  const emoji = { body, text: '😀', start: body.length - 2, end: body.length };
  expect(validQuote(emoji)).toBe(true);
  expect(quotePosition(body, emoji)).toBe(body.length - 2);
});

test('relocates edited text only when it can identify the passage', () => {
  expect(quotePosition('Inserted. ' + body, quote)).toBe(30);
  expect(quotePosition('match then match', quote)).toBe(null);
  expect(quotePosition('The passage was removed.', quote)).toBe(null);
});

test('rejects malformed offsets', () => {
  expect(validQuote({ ...quote, start: -1 })).toBe(false);
  expect(validQuote({ ...quote, end: 900 })).toBe(false);
  expect(validQuote({ ...quote, text: '' })).toBe(false);
  expect(validQuote({ ...quote, start: 1.5 })).toBe(false);
});

test('keeps paragraph breaks and masks concealed spoilers in the snapshot', () => {
  const root = document.createElement('div');
  root.innerHTML =
    '<p>First <strong>line</strong></p><p>Second<br>line <span data-mx-spoiler>secret</span></p>';
  expect(quoteDocument(root).body).toBe('First line\nSecond\nline [Spoiler]');
});

test('builds a highlight range across formatting and paragraph boundaries', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>Before <strong>selected</strong></p><p>passage after</p>';
  const doc = quoteDocument(root);
  const start = doc.body.indexOf('selected');
  const selected = { body: doc.body, text: 'selected\npassage', start, end: start + 16 };
  expect(validQuote(selected)).toBe(true);
  const clear = markQuote(root, selected);
  expect([...root.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
    'selected',
    'passage',
  ]);
  clear?.();
});

test('marks the selected occurrence without replacing formatting or links, and cleans up', async () => {
  const { markQuote } = await import('./selected-quote');
  const root = document.createElement('div');
  root.innerHTML = '<p>word <a href="https://example.org"><b>word</b></a> after</p>';
  const link = root.querySelector('a');
  const text = quoteDocument(root).body;
  const clear = markQuote(root, { body: text, text: 'word', start: 5, end: 9 });
  expect(root.querySelector('a')).toBe(link);
  expect(root.querySelector('b > mark')?.textContent).toBe('word');
  expect(root.querySelectorAll('mark')).toHaveLength(1);
  clear?.();
  expect(root.querySelectorAll('mark')).toHaveLength(0);
  expect(quoteDocument(root).body).toBe(text);
});

test('preserves literal trailing newlines in selected code', () => {
  const root = document.createElement('div');
  root.innerHTML = '<pre><code>const value = 1;\n\n</code></pre>';
  const { body } = quoteDocument(root);
  expect(body).toBe('const value = 1;\n\n');
  const quote = { body, text: body, start: 0, end: body.length };
  expect(validQuote(quote)).toBe(true);
  const clear = markQuote(root, quote);
  expect(root.querySelector('mark')?.textContent).toBe(body);
  clear?.();
});

test('keeps repeated code quotes stable when code controls change or remount', () => {
  const root = document.createElement('div');
  const block = (label: string) =>
    `<div class="code-block"><div class="code-head"><span>js</span><button>${label}</button></div><pre><code>same code</code></pre></div>`;
  root.innerHTML = block('Copy Expand') + block('Copied Collapse');
  const { body } = quoteDocument(root);
  expect(body).toBe('same code\nsame code');
  const quote = { body, text: 'same code', start: 10, end: 19 };

  // A remounted row restores the collapsed controls (possibly in another locale).
  root.innerHTML = block('复制 展开') + block('复制 展开');
  expect(quoteDocument(root).body).toBe(body);
  const clear = markQuote(root, quote);
  expect(root.querySelectorAll('mark')).toHaveLength(1);
  expect(root.querySelectorAll('code')[1].querySelector('mark')?.textContent).toBe('same code');
  expect(root.querySelector('.code-head mark')).toBeNull();
  clear?.();
  expect(quoteDocument(root).body).toBe(body);
});
