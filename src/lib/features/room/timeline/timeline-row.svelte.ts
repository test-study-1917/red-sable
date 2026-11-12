import { on } from 'svelte/events';
import { onDestroy, type Snippet } from 'svelte';

import type { MemberView, PerMessageProfileView, TimelineItemView } from '#src/generated/protocol';

import { copyText } from '#lib/platform/clipboard.js';
import { i18n } from '#lib/i18n.js';
import { toasts } from '#lib/ui/toasts.svelte.js';
import { useCoreClient } from '#lib/core/context.js';
import { cursorAnchor, type CursorAnchor } from '#lib/ui/cursor-anchor.js';
import { LongPress, touchContextMenu } from '#lib/ui/long-press.svelte.js';
import { DoubleTap } from '#lib/ui/double-tap.js';
import { hapticFeedback } from '#lib/platform/haptics.js';
import { usePersonaStore } from '#lib/personas/personas.svelte.js';
import { preferences, type TimelineLayout } from '#lib/settings/preferences.svelte.js';
import { useBookmarks } from '#lib/rooms/bookmarks.svelte.js';
import { useRoomCosmetics, type SenderCosmetics } from '#lib/rooms/room-cosmetics.svelte.js';
import type { MatrixLink } from '#lib/rooms/matrix-link.js';

import { senderDisplayColors } from '../members/members.js';
import { hasSenderRoles, useSenderRoles } from '../members/sender-roles.js';
import { MessageSwipe } from '../messages/message-swipe.svelte.js';
import { useMessageMenu } from '../messages/message-menu-open.svelte.js';
import type { MessageActions } from '../messages/message-menu-items';
import { useMessageDialogs } from '../messages/message-dialogs.svelte.js';
import {
  MessageActionExecutor,
  type MessageCallbacks,
} from '../messages/message-action-controller.svelte.js';
import { usePinnedEvents } from './pinned-events.svelte.js';
import type { TimelineEventIndex } from './timeline-event-index';
import { TimelineItemProfiles } from './timeline-item-profiles.svelte';
import { TimelineItemEngagement } from './timeline-item-engagement.svelte';
import { quoteFocus, revealQuote } from '../messages/quote-focus.svelte.js';
import { markQuote } from '../messages/selected-quote.js';
import { selectedQuote, selectedText, withSelectedText } from './timeline-item-selection';

export interface TimelineItemProps extends MessageCallbacks {
  item: TimelineItemView;
  collapsed: boolean;
  unreadCount?: number;
  replyPersona?: PerMessageProfileView | null;
  threadPersona?: PerMessageProfileView | null;
  roomId?: string;
  highlighted?: boolean;
  onMatrixLink?: (link: MatrixLink, anchor: HTMLAnchorElement) => void;
  onSenderProfile?: (
    userId: string,
    anchor: HTMLElement,
    pmp?: PerMessageProfileView | null
  ) => void;
  onMentionUser?: (userId: string, name: string) => void;
  onRetrySend?: (transactionId: string) => void;
  onCancelSend?: (transactionId: string) => void;
  currentUserId?: string | null;
  canRedactOwn?: boolean;
  canRedactOthers?: boolean;
  canPin?: boolean;
  encrypted?: boolean | null;
  selected?: boolean;
  editing?: boolean;
  editor?: Snippet;
  layout?: TimelineLayout;
  preview?: boolean;
  loadPreviewProfile?: boolean;
  timeAction?: { label: string; run: () => void };
  headerAction?: Snippet;
  alignOwn?: boolean;
  avatarsInHeaders?: boolean;
  members?: readonly MemberView[];
  onJumpToEvent?: (eventId: string) => void;
  onOpenMedia?: (eventId: string) => void;
  onVotePoll?: (eventId: string, answers: string[]) => void;
  onEndPoll?: (eventId: string) => void;
  events?: TimelineEventIndex;
  onMenuOpenChange?: (open: boolean) => void;
  placeholder?: boolean;
  placeholderCharacters?: number;
  overrideCosmetics?: SenderCosmetics | null;
  onSwipeMembers?: () => void;
}

export interface TimelineRowOptions extends MessageCallbacks {
  item: TimelineItemView;
  roomId: string;
  canPin: boolean;
  canRedactOwn: boolean;
  canRedactOthers: boolean;
  preview: boolean;
  loadPreviewProfile: boolean;
  selected: boolean;
  editing: boolean;
  overrideCosmetics: SenderCosmetics | null;
  replySender: string | null;
  hasLinkPreviews: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  onSwipeMembers?: () => void;
  onCancelSend?: (transactionId: string) => void;
}

export class TimelineRow {
  element = $state<HTMLElement | null>(null);
  #pointerHeld = false;
  #anchor = $state.raw<CursorAnchor | null>(null);
  actionsPinned = $state(false);

  readonly core = useCoreClient();
  readonly dialogs = useMessageDialogs();
  readonly menu = useMessageMenu();
  readonly profiles = new TimelineItemProfiles(this.core);
  readonly engagement = new TimelineItemEngagement(() => this.element);
  readonly actionExecutor: MessageActionExecutor;
  readonly swipe: MessageSwipe;
  readonly press: LongPress;
  readonly #doubleTap: DoubleTap;
  readonly #roomCosmetics = useRoomCosmetics();
  readonly #senderRoles = hasSenderRoles() ? useSenderRoles() : null;
  readonly #options: () => TimelineRowOptions;

  constructor(options: () => TimelineRowOptions) {
    this.#options = options;
    this.actionExecutor = new MessageActionExecutor(
      () => {
        const options = this.#options();
        return {
          ...options,
          senderTimezone: this.senderTimezone,
          anchor: this.#anchor ?? this.element,
          onEdit: options.item.forwarded ? undefined : options.onEdit,
        };
      },
      {
        core: this.core,
        personaStore: usePersonaStore(),
        pinnedEvents: usePinnedEvents(),
        bookmarks: useBookmarks(),
        dialogs: this.dialogs,
      }
    );
    this.swipe = new MessageSwipe({
      enabled: () =>
        this.actionable &&
        !selectedText(this.element) &&
        (this.swipeOpensMembers || this.actions.onReply !== undefined),
      canEdit: () =>
        this.actionable && !this.swipeOpensMembers && this.actions.onEdit !== undefined,
      onReply: () => {
        const { selected, onCancelContext, onSwipeMembers } = this.#options();
        if (this.swipeOpensMembers) onSwipeMembers?.();
        else if (selected) onCancelContext?.();
        else this.actions.onReply?.();
      },
      onEdit: () => {
        const { editing, onCancelContext } = this.#options();
        if (editing) onCancelContext?.();
        else this.actions.onEdit?.();
      },
    });
    this.press = new LongPress({
      enabled: () => this.actionable || this.canCancelSend,
      onPress: () => {
        const { item } = this.#options();
        this.menu.set(item.id, false);
        const selected = selectedText(this.element);
        const actions = this.selectionActions(selected);
        this.dialogs.open(item, {
          kind: 'sheet',
          actions: () => actions,
        });
      },
    });
    this.#doubleTap = new DoubleTap(() => {
      if (
        !this.actionable ||
        selectedText(this.element) ||
        !preferences.doubleTapReact ||
        !this.actions.onReact
      )
        return;
      hapticFeedback();
      this.actions.onReact(preferences.doubleTapReaction);
    });

    $effect(() => {
      const target = quoteFocus.target;
      const node = this.element;
      const { roomId, item, preview } = this.#options();
      if (
        preview ||
        !target ||
        !node ||
        target.roomId !== roomId ||
        target.eventId !== item.event_id
      )
        return;
      const body = node.querySelector<HTMLElement>('.message-main .formatted-body');
      if (!body) return;
      const clear = markQuote(body, target.quote);
      if (!clear) {
        toasts.info(i18n.t('timeline.quoteChanged'));
        return;
      }
      const mark = body.querySelector('.quoted-passage-highlight');
      if (mark) revealQuote(target, mark);
      return clear;
    });

    $effect(() => {
      const { item, replySender, preview, loadPreviewProfile } = this.#options();
      this.profiles.sync(item.sender, replySender, preview && !loadPreviewProfile);
    });

    // A virtualised row can unmount mid-press, so the pending timer has to go.
    onDestroy(() => {
      this.press.cancel();
      this.profiles.dispose();
    });
  }

  readonly profile = $derived(this.profiles.sender);
  readonly senderTimezone = $derived(this.profile?.timezone ?? null);
  readonly senderCosmetics = $derived.by(() => {
    const { item, overrideCosmetics } = this.#options();
    return overrideCosmetics ?? this.#roomCosmetics?.for(item.sender) ?? null;
  });
  readonly senderRole = $derived.by(() => {
    const { item } = this.#options();
    return item.sender ? (this.#senderRoles?.(item.sender) ?? null) : null;
  });
  readonly senderColors = $derived.by(() => {
    const { item } = this.#options();
    return senderDisplayColors(
      item.sender ?? '',
      this.profile,
      item.per_message_profile,
      item.is_own,
      this.senderCosmetics,
      this.senderRole?.color ?? null
    );
  });
  readonly stalled = $derived.by(() => {
    const { send_state } = this.#options().item;
    return send_state?.status === 'failed' ? send_state : null;
  });
  readonly pending = $derived.by(() => this.#options().item.send_state?.status === 'sending');
  readonly swipeOpensMembers = $derived.by(
    () =>
      preferences.messageSwipeAction === 'members' && this.#options().onSwipeMembers !== undefined
  );
  readonly actionable = $derived.by(() => {
    const { item, preview } = this.#options();
    return !preview && item.event_id !== null && this.stalled === null && !this.pending;
  });
  readonly canCancelSend = $derived.by(() => {
    const { item, preview, onCancelSend } = this.#options();
    return !preview && this.pending && item.transaction_id !== null && onCancelSend !== undefined;
  });
  readonly actions = $derived.by((): MessageActions => {
    if (!this.canCancelSend) return this.actionExecutor.actions;
    return {
      onCancelSend: () => {
        const { item, onCancelSend } = this.#options();
        if (this.pending && item.transaction_id) onCancelSend?.(item.transaction_id);
      },
    };
  });
  readonly showActions = $derived(
    (this.actionable || this.canCancelSend) && (this.engagement.engaged || this.actionsPinned)
  );

  selectionActions(text: string, quote = selectedQuote(this.element)): MessageActions {
    const { item, onReply, onQuoteMarkdown } = this.#options();
    const eventId = item.event_id;
    return {
      ...withSelectedText(this.actions, text),
      onQuoteMarkdown:
        quote && this.actions.onReply && onQuoteMarkdown
          ? () => onQuoteMarkdown(quote.text)
          : undefined,
      onQuoteReply:
        quote && this.actions.onReply && onReply && eventId
          ? () =>
              onReply(eventId, {
                of: eventId,
                body: quote.body,
                html: null,
                selectedQuote: quote,
              })
          : undefined,
    };
  }

  attach = (node: HTMLElement): (() => void) => {
    this.element = node;
    const detachSwipe = this.swipe.attach(node);
    let timer: ReturnType<typeof setTimeout>;
    const scheduleSelection = () => {
      clearTimeout(timer);
      if (!selectedQuote(node)) return;
      // Touch selection handles settle before the shared selection menu opens.
      timer = setTimeout(() => {
        if (this.#pointerHeld) {
          scheduleSelection();
          return;
        }
        if (
          !this.actionable ||
          this.menu.id !== null ||
          this.dialogs.isOpen(this.#options().item, 'sheet')
        )
          return;
        const quote = selectedQuote(node);
        const selection = getSelection();
        if (!quote || !selection) return;
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        this.menu.open(this.#options().item.id, { x: rect.left, y: rect.bottom }, () =>
          this.selectionActions(quote.text, quote)
        );
      }, 450);
    };
    const detachSelection = on(document, 'selectionchange', scheduleSelection);
    const release = () => {
      this.#pointerHeld = false;
      scheduleSelection();
    };
    const detachRelease = on(window, 'pointerup', release);
    const detachCancel = on(window, 'pointercancel', release);
    return () => {
      clearTimeout(timer);
      detachSelection();
      detachRelease();
      detachCancel();
      detachSwipe();
      this.element = null;
    };
  };

  pinActions = (open: boolean): void => {
    if (open) this.#anchor = null;
    this.actionsPinned = open;
    this.#options().onMenuOpenChange?.(open);
  };

  pointerDown = (event: PointerEvent): void => {
    this.#pointerHeld = true;
    if (
      event.pointerType !== 'mouse' &&
      event.target instanceof Element &&
      event.target.closest('.formatted-body')
    )
      this.press.cancel();
    else this.press.start(event);
    this.#doubleTap.down(event);
    if (event.pointerType === 'mouse') this.engagement.hold();
  };

  pointerUp = (event: PointerEvent): void => {
    this.#pointerHeld = false;
    this.press.end(event);
    this.#doubleTap.up(event);
  };

  pointerCancel = (event: PointerEvent): void => {
    this.#pointerHeld = false;
    this.press.end(event);
    this.#doubleTap.cancel();
  };

  openContextMenu = (event: MouseEvent): void => {
    // On touch, let the platform establish a text selection before offering quote actions.
    if (
      touchContextMenu(event) &&
      event.target instanceof Element &&
      event.target.closest('.formatted-body')
    )
      return;
    const { item } = this.#options();
    if (this.press.touch || touchContextMenu(event)) {
      event.preventDefault();
      if (
        (this.actionable || this.canCancelSend) &&
        !this.press.pending &&
        !this.dialogs.isOpen(item, 'sheet')
      )
        this.press.fire(event);
      return;
    }
    if (!this.actionable && !this.canCancelSend) {
      if (this.pending) event.preventDefault();
      return;
    }
    event.preventDefault();
    this.#anchor = cursorAnchor(event);
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href]')?.href
        : null;
    const selected = selectedText(this.element);
    const quote = selectedQuote(this.element);
    this.menu.open(item.id, { x: event.clientX, y: event.clientY }, () => ({
      ...this.selectionActions(selected, quote),
      onCopyHref:
        link && this.actionable
          ? () => {
              void copyText(link)
                .then(() => toasts.info(i18n.t('timeline.linkCopied')))
                .catch(() => toasts.error(i18n.t('errors.copyFailed')));
            }
          : undefined,
    }));
  };
}
