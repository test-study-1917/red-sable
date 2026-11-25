<script lang="ts">
  import { validQuote } from '../messages/selected-quote.js';
  import { setQuoteFocus } from '../messages/quote-focus.svelte.js';
  import ReplyIcon from 'phosphor-svelte/lib/ArrowBendUpRightIcon';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
  import { SvelteSet } from 'svelte/reactivity';

  import type {
    MemberView,
    PerMessageProfileView,
    ProfileView,
    ReplyView,
    TimelineItemView,
  } from '#src/generated/protocol';

  import { i18n } from '#lib/i18n.js';
  import { preferences } from '#lib/settings/preferences.svelte.js';
  import MediaImage from '#lib/ui/MediaImage.svelte';
  import {
    hasRoomMediaPreviews,
    useRoomMediaPreviews,
  } from '../media/room-media-previews.svelte.js';
  import { findMember, stripReplyFallback, useSenderColors } from '../members/members.js';
  import SenderName from '../members/SenderName.svelte';
  import { replyText } from '../messages/reply-fallback.js';
  import { previewSegments } from '../messages/reply-preview.js';
  import { stateEventText } from './state-event-text';

  interface Props {
    reply: ReplyView;
    roomId?: string;
    previewHeight?: number;
    target: TimelineItemView | null;
    sender: string | null;
    persona: PerMessageProfileView | null;
    profile: ProfileView | null;
    currentUserId: string | null;
    members: readonly MemberView[];
    onJumpToEvent?: (eventId: string) => void;
  }

  let {
    reply,
    roomId = '',
    previewHeight = $bindable(0),
    target,
    sender,
    persona,
    profile,
    currentUserId,
    members,
    onJumpToEvent,
  }: Props = $props();

  const sourceId = $props.id();
  let expanded = $state(false);
  let headerHeight = $state(0);
  let quote = $derived(validQuote(reply.selected_quote) ? reply.selected_quote : null);
  function jumpToQuote(): void {
    if (quote) setQuoteFocus({ roomId, eventId: reply.event_id, quote });
    onJumpToEvent?.(reply.event_id);
  }

  function centerQuotedPassage(node: HTMLElement): () => void {
    const frame = requestAnimationFrame(() => {
      const mark = node.querySelector('mark');
      if (!mark) return;
      node.scrollTop +=
        mark.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        node.clientHeight / 2 +
        mark.getBoundingClientRect().height / 2;
    });
    return () => cancelAnimationFrame(frame);
  }

  const senderColors = useSenderColors();
  const roomMedia = hasRoomMediaPreviews() ? useRoomMediaPreviews() : null;
  const failedEmotes = new SvelteSet<string>();

  let roomName = $derived.by(() => {
    const member = findMember(members, sender);
    // eslint-disable-next-line no-restricted-properties -- before the profile name
    return member ? member.display_name : (reply.sender_name ?? target?.sender_name ?? null);
  });
  let nameBase = $derived(
    persona?.display_name ?? roomName ?? sender ?? i18n.t('timeline.unknownSender')
  );
  let name = $derived(
    reply.sender_mentioned && !nameBase.startsWith('@') ? `@${nameBase}` : nameBase
  );
  let segments = $derived.by(() => {
    if (quote) return [quote.text];
    const kind = target?.content.kind;
    if (
      target &&
      (kind === 'membership' ||
        kind === 'profile_change' ||
        kind === 'state_event' ||
        kind === 'hidden_event')
    ) {
      return [stateEventText(target, i18n.t)];
    }
    const text = stripReplyFallback(replyText(reply, i18n.t), persona);
    return roomMedia?.hidden ? [text] : previewSegments(text, reply.emotes);
  });
  let colors = $derived(
    senderColors(sender, profile, {
      persona,
      isOwn: currentUserId !== null && sender === currentUserId,
    })
  );
</script>

{#snippet copy()}
  <span class="reply-copy"
    ><SenderName displayName={name} {colors} nameClass="reply-name" compact />
    <span class="reply-body" dir="auto"
      >{#each segments as segment, index (index)}{#if typeof segment === 'string' || failedEmotes.has(segment.source)}{typeof segment ===
          'string'
            ? segment
            : segment.alt}{:else}<MediaImage
            class="reply-emote"
            source={segment.source}
            alt={segment.alt}
            title={segment.alt}
            width={64}
            height={64}
            original
            emoticon
            onfailed={(source) => failedEmotes.add(source)}
          />{/if}{/each}</span
    ></span
  >
{/snippet}

{#if quote}
  <div
    class={['reply-preview', `reply-${preferences.replyPreviewStyle}`, 'selected-reply']}
    class:quote-open={expanded}
    style:--reply-connector-y={headerHeight > 0 ? `${String(headerHeight / 2)}px` : undefined}
    bind:clientHeight={previewHeight}
  >
    <div class="quote-header" bind:clientHeight={headerHeight}>
      <button
        class="quote-summary"
        type="button"
        onclick={jumpToQuote}
        title={i18n.t('timeline.jumpToQuote')}
      >
        {#if preferences.replyPreviewStyle !== 'connected'}
          <ReplyIcon class="mirror-rtl reply-icon" />
        {/if}
        {@render copy()}
      </button>
      <button
        class="quote-toggle"
        type="button"
        aria-label={i18n.t(expanded ? 'timeline.collapseQuote' : 'timeline.expandQuote')}
        title={i18n.t(expanded ? 'timeline.collapseQuote' : 'timeline.expandQuote')}
        aria-expanded={expanded}
        aria-controls={sourceId}
        onclick={() => (expanded = !expanded)}
      >
        <CaretDownIcon aria-hidden="true" />
      </button>
    </div>
    {#if expanded}
      <div class="quoted-source" dir="auto" id={sourceId} {@attach centerQuotedPassage}>
        {quote.body.slice(0, quote.start)}<mark>{quote.text}</mark>{quote.body.slice(quote.end)}
      </div>
    {/if}
  </div>
{:else if preferences.replyPreviewStyle === 'connected'}
  <button
    class={['reply-preview', 'reply-connected']}
    bind:clientHeight={previewHeight}
    type="button"
    onclick={() => {
      onJumpToEvent?.(reply.event_id);
    }}
  >
    {@render copy()}
  </button>
{:else}
  <button
    class={['reply-preview', `reply-${preferences.replyPreviewStyle}`]}
    bind:clientHeight={previewHeight}
    type="button"
    onclick={() => {
      onJumpToEvent?.(reply.event_id);
    }}
  >
    <ReplyIcon class="mirror-rtl reply-icon" />
    {@render copy()}
  </button>
{/if}

<style>
  .reply-preview {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--radius);
    color: var(--surface-on-container);
    cursor: pointer;
    display: grid;
    font: inherit;
    font-size: var(--font-size-small);
    gap: var(--space-200);
    grid-template-columns: auto minmax(0, 1fr);
    line-height: 1.4;
    margin: 0;
    margin-bottom: var(--space-100);
    padding: var(--space-100) var(--space-200);
    text-align: start;
    width: 100%;
  }

  .reply-preview :global(.reply-icon) {
    color: var(--primary-main);
    height: var(--icon-size-small);
    width: var(--icon-size-small);
  }

  .reply-copy {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reply-body :global(.reply-emote) {
    display: inline-block;
    height: 1.25em;
    max-width: 6em;
    object-fit: contain;
    vertical-align: middle;
    width: calc(1.25em * var(--media-ratio, 1));
  }

  /* WebKit uses a clipped inline-block's bottom as its baseline. */
  :global(.reply-name) {
    display: inline-block;
    overflow: clip;
    vertical-align: top;
  }

  .reply-compact {
    gap: var(--space-100);
    padding: 0;
  }

  .reply-compact :global(.reply-icon) {
    height: var(--size-x50);
    width: var(--size-x50);
  }

  .reply-compact :global(.reply-name),
  .reply-connected :global(.reply-name) {
    margin-inline-end: var(--space-100);
  }

  .reply-compact .reply-body,
  .reply-connected .reply-body {
    filter: brightness(var(--opacity-p300));
  }

  .reply-connected {
    --reply-connector-width: var(--border-width-500);

    grid-column: 1 / -1;
    grid-template-columns: minmax(0, 1fr);
    margin-bottom: var(--space-100);
    min-height: var(--space-500);
    overflow: visible;
    padding-block: 0;
    padding-inline: 0;
    position: relative;
  }

  .reply-connected::before {
    border-inline-start: var(--reply-connector-width) solid var(--surface-on-container);
    border-start-start-radius: var(--radius);
    border-top: var(--reply-connector-width) solid var(--surface-on-container);
    content: '';
    height: calc(var(--space-250) + var(--border-width-300));
    inset-inline-start: calc(
      -1 *
        (var(--timeline-row-gap) + var(--avatar-size-small) / 2 + var(--reply-connector-width) / 2)
    );
    opacity: var(--opacity-placeholder);
    pointer-events: none;
    position: absolute;
    top: calc(var(--reply-connector-y, 50%) - var(--border-width-300));
    width: calc(
      var(--timeline-row-gap) / 2 + var(--avatar-size-small) / 2 + var(--reply-connector-width) / 2
    );
  }

  .reply-connected:is(:hover, :focus-visible)::before {
    opacity: var(--opacity-p300);
  }

  .reply-expanded {
    --reply-accent-width: var(--border-width-600);

    align-items: start;
    background: var(--surface-var-container);
    color: var(--surface-var-on-container);
    grid-template-columns: auto minmax(0, 1fr);
    padding: var(--space-200) var(--space-300) var(--space-200)
      calc(var(--space-300) + var(--reply-accent-width));
    position: relative;
  }

  .reply-expanded::before {
    background: var(--primary-main);
    bottom: 0;
    content: '';
    inset-inline-start: 0;
    pointer-events: none;
    position: absolute;
    top: 0;
    width: var(--reply-accent-width);
  }

  .reply-expanded .reply-copy {
    display: grid;
    gap: var(--space-050);
    white-space: normal;
  }

  .reply-expanded .reply-body {
    -webkit-box-orient: vertical;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    overflow: hidden;
    white-space: pre-wrap;
  }

  .reply-preview:is(:hover, :focus-visible) .reply-body {
    filter: brightness(var(--opacity-p500));
  }

  .reply-expanded:is(:hover, :focus-visible) {
    background: var(--surface-var-container-hover);
  }

  .reply-preview:focus-visible .reply-copy {
    text-decoration: underline;
    text-decoration-thickness: var(--border-width);
    text-underline-offset: 0.15em;
  }

  :global(.message.layout-compact) .reply-connected::before {
    inset-inline-start: calc(var(--space-050) - var(--space-300));
    width: calc(var(--space-300) - var(--space-150));
  }

  :global(.message.layout-bubble.own.align-own) .reply-preview {
    grid-template-columns: minmax(0, 1fr) auto;
    text-align: end;
    width: auto;
  }

  :global(.message.layout-bubble.own.align-own) .reply-preview :global(.reply-icon) {
    grid-column: 2;
    grid-row: 1;
  }

  :global(.message.layout-bubble.own.align-own) .reply-connected {
    justify-self: end;
    max-width: 100%;
    text-align: end;
  }

  :global(.message.layout-bubble.own.align-own) .reply-connected::before {
    display: none;
  }

  .reply-preview.selected-reply {
    cursor: default;
    display: block;
  }

  .quote-header {
    align-items: start;
    display: grid;
    gap: var(--space-100);
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 0;
  }

  .quote-summary,
  .quote-toggle {
    background: transparent;
    border: 0;
    border-radius: var(--radius-inner);
    color: inherit;
    cursor: pointer;
    font: inherit;
    min-height: var(--space-500);
    padding: 0;
  }

  .quote-summary {
    align-items: center;
    display: grid;
    gap: var(--space-200);
    grid-template-columns: auto minmax(0, 1fr);
    min-width: 0;
    text-align: inherit;
  }

  .reply-expanded .quote-summary {
    align-items: start;
  }

  .selected-reply.reply-connected::before {
    height: calc(100% - var(--reply-connector-y, var(--space-250)) + var(--space-100));
  }

  .reply-compact .quote-summary {
    gap: var(--space-100);
  }

  .reply-connected .quote-summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .quote-toggle {
    align-items: center;
    color: var(--surface-on-container);
    display: flex;
    justify-content: center;
    width: var(--space-600);
  }

  .quote-toggle :global(svg) {
    height: var(--size-x50);
    width: var(--size-x50);
  }

  .quote-open .quote-toggle :global(svg) {
    rotate: 180deg;
  }

  .quote-toggle:is(:hover, :focus-visible) {
    background: var(--surface-container-hover);
    color: var(--primary-main);
  }

  .quote-summary:focus-visible,
  .quote-toggle:focus-visible {
    outline: var(--border-width-500) solid var(--primary-main);
    outline-offset: var(--space-050);
  }

  .quote-summary:is(:hover, :focus-visible) .reply-body {
    filter: brightness(var(--opacity-p500));
  }

  .quoted-source {
    line-height: 1.35;
    margin-top: var(--space-100);
    max-height: 12rem;
    overflow: auto;
    overflow-wrap: anywhere;
    padding-inline-end: var(--space-100);
    scrollbar-width: thin;
    text-align: start;
    user-select: text;
    white-space: pre-wrap;
  }

  .reply-expanded .quoted-source {
    margin-inline-start: calc(var(--icon-size-small) + var(--space-200));
  }

  .reply-compact .quoted-source {
    margin-inline-start: calc(var(--size-x50) + var(--space-100));
  }

  .quoted-source mark {
    background: var(--warn-container);
    border-radius: var(--radii-200);
    color: var(--warn-on-container);
  }

  :global(.message.layout-bubble.own.align-own) .selected-reply .quote-summary {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  :global(.message.layout-bubble.own.align-own) .reply-connected .quote-summary {
    grid-template-columns: minmax(0, 1fr);
  }

  :global(.message.layout-bubble.own.align-own) .reply-expanded :global(.reply-name) {
    justify-self: end;
  }

  :global(.message.layout-bubble.own.align-own) .selected-reply .quoted-source {
    margin-inline: 0;
  }

  @media (any-pointer: coarse) {
    .quote-summary,
    .quote-toggle {
      min-height: var(--space-700);
    }

    .quote-toggle {
      width: var(--space-700);
    }
  }
</style>
