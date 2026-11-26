<script lang="ts">
  import type { Component } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { MemberView } from '#src/generated/protocol';
  import ChatCenteredTextIcon from 'phosphor-svelte/lib/ChatCenteredTextIcon';
  import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
  import FileAudioIcon from 'phosphor-svelte/lib/FileAudioIcon';
  import FileIcon from 'phosphor-svelte/lib/FileIcon';
  import FileImageIcon from 'phosphor-svelte/lib/FileImageIcon';
  import FilePdfIcon from 'phosphor-svelte/lib/FilePdfIcon';
  import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
  import FileVideoIcon from 'phosphor-svelte/lib/FileVideoIcon';
  import FileZipIcon from 'phosphor-svelte/lib/FileZipIcon';

  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import { downloadBytes } from '#lib/ui/download.js';
  import { mediaViewerState } from '#lib/ui/media/media-viewer-state.svelte.ts';
  import type { MediaItem } from '#lib/ui/media/media-viewer-types.js';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import { toasts } from '#lib/ui/toasts.svelte.js';

  import { memberName } from '../members/members';
  import AttachmentMeta from './AttachmentMeta.svelte';
  import RoomAttachmentFeed from './RoomAttachmentFeed.svelte';
  import {
    attachmentKey,
    attachmentLabel,
    closingJump,
    viewerFields,
    type RoomAttachmentOf,
  } from './room-attachments';
  import { RoomAttachmentsPager } from './room-attachments-pager.svelte';

  interface Props {
    roomId: string;
    members: readonly MemberView[];
    modal?: boolean;
    onJump: (eventId: string) => void;
    onClose?: () => void;
  }

  let { roomId, members, modal = false, onJump, onClose }: Props = $props();

  type FileAttachment = RoomAttachmentOf<'file'>;

  const core = useCoreClient();
  const pager = new RoomAttachmentsPager(core, 'file');
  const downloads = new SvelteSet<string>();

  let viewerItems = $derived(pager.items.map((item) => mediaItem(item)));
  let jump = $derived(closingJump(modal, onClose, onJump));

  function senderOf(item: FileAttachment): string {
    return memberName(members, item.sender);
  }

  function mediaItem(item: FileAttachment): MediaItem {
    const content = item.content;
    const shared = {
      ...viewerFields(item, senderOf(item)),
      filename: content.filename,
      source: content.source,
      mime: content.mime,
    };
    return content.mime?.startsWith('audio/')
      ? {
          ...shared,
          kind: 'audio',
          duration_ms: null,
          waveform: null,
          voice: false,
          metadata: null,
        }
      : { ...shared, kind: 'file', size: content.size };
  }

  function open(item: FileAttachment): void {
    mediaViewerState.openPanel(viewerItems, attachmentKey(item), jump);
  }

  async function download(key: string, content: FileAttachment['content']): Promise<void> {
    downloads.add(key);
    try {
      const bytes = await core.media.fetchMedia(content.source, 0, 0);
      await downloadBytes(bytes, content.filename, content.mime);
    } catch (error) {
      console.warn('[sable attachments] file download failed', error);
      toasts.error(i18n.t('errors.actionFailed'));
    } finally {
      downloads.delete(key);
    }
  }

  function fileIcon(mime: string | null): Component {
    const type = mime ?? '';
    if (type.startsWith('audio/')) return FileAudioIcon;
    if (type.startsWith('video/')) return FileVideoIcon;
    if (type.startsWith('image/')) return FileImageIcon;
    if (type === 'application/pdf') return FilePdfIcon;
    if (type.startsWith('text/')) return FileTextIcon;
    if (/zip|x-7z|x-rar|x-tar|gzip|x-bzip/.test(type)) return FileZipIcon;
    return FileIcon;
  }
</script>

<RoomAttachmentFeed {pager} {roomId} layout="rows" empty="timeline.attachmentsFilesEmpty">
  {#snippet item(item: FileAttachment)}
    {@const content = item.content}
    {@const key = attachmentKey(item)}
    {@const downloading = downloads.has(key)}
    {@const Icon = fileIcon(content.mime)}
    <div class="attachment-row">
      <button
        type="button"
        class="attachment-preview"
        aria-label={attachmentLabel(item, content.filename, senderOf(item))}
        onclick={() => open(item)}
      >
        <Icon class="attachment-icon" aria-hidden="true" />
        <span class="attachment-text">
          <span class="attachment-name">{content.filename}</span>
          <AttachmentMeta sender={senderOf(item)} timestamp={item.timestamp} size={content.size} />
        </span>
      </button>
      <div class="attachment-actions">
        <IconButton
          variant="ghost"
          size="small"
          label={`${i18n.t('common.download')}: ${content.filename}`}
          title={i18n.t('common.download')}
          loading={downloading}
          onclick={() => void download(key, content)}
        >
          {#if !downloading}<DownloadSimpleIcon />{/if}
        </IconButton>
        <IconButton
          variant="ghost"
          size="small"
          label={`${i18n.t('common.jumpToMessage')}: ${content.filename}`}
          title={i18n.t('common.jumpToMessage')}
          onclick={() => jump(item.event_id)}
        >
          <ChatCenteredTextIcon />
        </IconButton>
      </div>
    </div>
  {/snippet}
</RoomAttachmentFeed>

<style>
  .attachment-row {
    align-items: center;
    display: flex;
    padding-inline-end: var(--space-100);
  }

  .attachment-actions {
    display: flex;
  }

  .attachment-actions :global(.icon-button) {
    --button-height: var(--target-hit);
  }

  .attachment-preview {
    align-items: start;
    align-self: stretch;
    background: none;
    border: 0;
    border-radius: var(--radius);
    color: inherit;
    cursor: pointer;
    display: flex;
    flex: 1;
    font: inherit;
    gap: var(--space-300);
    min-width: 0;
    padding: var(--space-200);
    text-align: start;
  }

  .attachment-preview:hover {
    background: var(--bg-container-hover);
  }

  .attachment-preview:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring);
    outline-offset: calc(var(--focus-ring-width) * -1);
  }

  .attachment-preview :global(.attachment-icon) {
    color: var(--surface-var-on-container);
    flex: none;
    height: var(--icon-size-medium);
    width: var(--icon-size-medium);
  }

  .attachment-text {
    display: grid;
    gap: var(--space-100);
    min-width: 0;
  }

  .attachment-name {
    -webkit-box-orient: vertical;
    display: -webkit-box;
    font-weight: var(--font-weight-medium);
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
</style>
