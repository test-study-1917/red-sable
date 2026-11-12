import type { SelectedQuote } from '#src/generated/protocol';

export const QUOTE_HIGHLIGHT_DURATION = 60_000;
const QUOTE_HIGHLIGHT_FADE_DURATION = 5_000;

type QuoteTarget = {
  roomId: string;
  eventId: string;
  quote: SelectedQuote;
  startedAt: number;
};

// Retained across timeline-window loading and virtualised row mounting.
export const quoteFocus = $state<{ target: QuoteTarget | null }>({ target: null });

let expiry: ReturnType<typeof setTimeout> | undefined;
let revealed: QuoteTarget | null = null;
export function setQuoteFocus(target: Omit<QuoteTarget, 'startedAt'> | null): void {
  clearTimeout(expiry);
  expiry = undefined;
  revealed = null;
  quoteFocus.target = target ? { ...target, startedAt: Date.now() } : null;
  const current = quoteFocus.target;
  if (current) {
    expiry = setTimeout(() => {
      if (quoteFocus.target === current) setQuoteFocus(null);
    }, QUOTE_HIGHLIGHT_DURATION);
  }
}

// Rerenders and virtualisation resume the original fade; only a new jump may scroll.
export function revealQuote(target: QuoteTarget, marks: NodeListOf<HTMLElement>): () => void {
  const elapsed = Date.now() - target.startedAt;
  const animations = Array.from(marks, (mark) => {
    const animation = mark.animate(
      [
        {
          backgroundColor: 'var(--warn-container)',
          color: 'var(--warn-on-container)',
          textDecorationColor: 'currentColor',
        },
        { backgroundColor: 'transparent', color: 'inherit', textDecorationColor: 'transparent' },
      ],
      {
        duration: QUOTE_HIGHLIGHT_FADE_DURATION,
        delay: QUOTE_HIGHLIGHT_DURATION - QUOTE_HIGHLIGHT_FADE_DURATION,
        easing: 'linear',
        fill: 'forwards',
      }
    );
    animation.currentTime = elapsed;
    return animation;
  });
  if (marks.length > 0 && revealed !== target) {
    revealed = target;
    marks[0].scrollIntoView({ block: 'nearest' });
  }
  return () => {
    for (const animation of animations) animation.cancel();
  };
}
