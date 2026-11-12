import type { SelectedQuote } from '#src/generated/protocol';

// Retained across timeline-window loading and virtualised row mounting.
export const quoteFocus = $state<{
  target: { roomId: string; eventId: string; quote: SelectedQuote } | null;
}>({ target: null });

// Highlight updates may follow reactions or receipt changes; only a new jump may scroll.
let revealed: object | null = null;
export function revealQuote(target: object, mark: Element): void {
  if (revealed === target) return;
  revealed = target;
  mark.scrollIntoView({ block: 'nearest' });
}
