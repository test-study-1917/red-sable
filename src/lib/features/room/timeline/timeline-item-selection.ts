import { quoteDocument } from '../messages/selected-quote.js';
import type { SelectedQuote } from '#src/generated/protocol';
import { copyText } from '#lib/platform/clipboard.js';
import { i18n } from '#lib/i18n.js';
import { toasts } from '#lib/ui/toasts.svelte.js';

import type { MessageActions } from '../messages/message-menu-items.js';

export function selectedText(row: HTMLElement | null): string {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !row) return '';
  if (!row.contains(selection.anchorNode) || !row.contains(selection.focusNode)) {
    return '';
  }
  return selection.toString();
}

export function withSelectedText(base: MessageActions, text: string): MessageActions {
  if (!text) return base;
  return {
    ...base,
    onCopyText: () => {
      void copyText(text)
        .then(() => toasts.info(i18n.t('common.copied')))
        .catch(() => toasts.error(i18n.t('errors.actionFailed')));
    },
    copyTextLabel: 'timeline.copySelection',
  };
}

export function selectedQuote(row: HTMLElement | null): SelectedQuote | null {
  const selection = getSelection();
  if (!row || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const body = (
    selection.anchorNode instanceof Element
      ? selection.anchorNode
      : selection.anchorNode?.parentElement
  )?.closest<HTMLElement>('.formatted-body');
  if (!body || !row.contains(body) || !body.contains(selection.focusNode)) return null;
  if (body.closest('.reply-preview, .quoted-source')) return null;
  const range = selection.getRangeAt(0);
  if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return null;
  // Hidden spoilers are masked in the snapshot; do not select through one.
  if (
    [...body.querySelectorAll('[data-mx-spoiler]:not([aria-pressed="false"])')].some((node) =>
      range.intersectsNode(node)
    )
  )
    return null;
  const doc = quoteDocument(body);
  let start: number | null = null;
  let end = 0;
  for (const part of doc.parts) {
    if (!range.intersectsNode(part.node)) continue;
    const from = part.node === range.startContainer ? range.startOffset : 0;
    const to = part.node === range.endContainer ? range.endOffset : part.node.length;
    if (from === to) continue;
    start ??= part.start + from;
    end = part.start + to;
  }
  if (start === null) return null;
  const text = doc.body.slice(start, end);
  if (!text.trim()) return null;
  return { body: doc.body, text, start, end };
}
