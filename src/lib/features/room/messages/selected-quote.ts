import type { SelectedQuote } from '#src/generated/protocol';

type TextPart = { node: Text; start: number; end: number };

/** The same rendered-text projection is used for capture and highlighting. */
export function quoteDocument(root: Node): { body: string; parts: TextPart[] } {
  let body = '';
  let trailingBlockBreak = false;
  const append = (text: string) => {
    if (!text) return;
    body += text;
    trailingBlockBreak = false;
  };
  const parts: TextPart[] = [];
  const lineBreak = () => {
    if (body && !body.endsWith('\n')) {
      body += '\n';
      trailingBlockBreak = true;
    }
  };
  const visit = (node: Node) => {
    if (node instanceof Text) {
      const start = body.length;
      append(node.data);
      parts.push({ node, start, end: body.length });
      return;
    }
    if (node instanceof Element) {
      if (node.matches('[data-mx-spoiler]:not([aria-pressed="false"])')) {
        append('[Spoiler]');
        return;
      }
      if (node.tagName === 'BR') {
        append('\n');
        return;
      }
      if (node.tagName === 'IMG') {
        append(node.getAttribute('alt') ?? '');
        return;
      }
      const block = /^(?:P|DIV|PRE|BLOCKQUOTE|H[1-6]|LI|TR)$/.test(node.tagName);
      if (block) lineBreak();
      node.childNodes.forEach(visit);
      if (block) lineBreak();
      return;
    }
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return { body: trailingBlockBreak ? body.slice(0, -1) : body, parts };
}

/** Offsets count UTF-16 code units, like a browser range. */
export function validQuote(quote: SelectedQuote | null | undefined): quote is SelectedQuote {
  return (
    !!quote &&
    typeof quote.body === 'string' &&
    typeof quote.text === 'string' &&
    quote.text.length > 0 &&
    Number.isInteger(quote.start) &&
    Number.isInteger(quote.end) &&
    quote.start >= 0 &&
    quote.end > quote.start &&
    quote.end <= quote.body.length &&
    quote.body.slice(quote.start, quote.end) === quote.text
  );
}

export function quotePosition(body: string, quote: SelectedQuote): number | null {
  if (!validQuote(quote)) return null;
  if (body === quote.body) return quote.start;
  // An edited message may move the passage. Context must distinguish repeated text.
  const prefix = quote.body.slice(Math.max(0, quote.start - 32), quote.start);
  const suffix = quote.body.slice(quote.end, quote.end + 32);
  const candidates: number[] = [];
  for (let at = body.indexOf(quote.text); at !== -1; at = body.indexOf(quote.text, at + 1)) {
    candidates.push(at);
  }
  if (candidates.length === 1) return candidates[0];
  const contextual = candidates.filter(
    (at) =>
      (!prefix || body.slice(Math.max(0, at - prefix.length), at) === prefix) &&
      (!suffix ||
        body.slice(at + quote.text.length, at + quote.text.length + suffix.length) === suffix)
  );
  return contextual.length === 1 ? contextual[0] : null;
}

/** Mark only text nodes; links, formatting and delegated message controls stay intact. */
export function markQuote(body: HTMLElement, quote: SelectedQuote): (() => void) | null {
  const doc = quoteDocument(body);
  const start = quotePosition(doc.body, quote);
  if (start === null) return null;
  const end = start + quote.text.length;
  const marks: HTMLElement[] = [];
  for (const part of [...doc.parts].reverse()) {
    const from = Math.max(0, start - part.start);
    const to = Math.min(part.node.length, end - part.start);
    if (from >= to) continue;
    const node = part.node;
    if (to < node.length) node.splitText(to);
    const selected = from ? node.splitText(from) : node;
    const mark = document.createElement('mark');
    mark.className = 'quoted-passage-highlight';
    selected.replaceWith(mark);
    mark.append(selected);
    marks.push(mark);
  }
  return marks.length
    ? () => {
        for (const mark of marks) mark.replaceWith(...mark.childNodes);
      }
    : null;
}
