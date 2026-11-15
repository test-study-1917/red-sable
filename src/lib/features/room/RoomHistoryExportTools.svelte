<script lang="ts">
  import { getContext, onDestroy, tick } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { mediaViewerState } from '#lib/ui/media/media-viewer-state.svelte.js';
  import {
    HISTORY_EXPORT_CONTEXT,
    type RoomHistoryExportContext,
  } from './room-history-export-context.js';
  import RoomHistoryDateTimePicker from './RoomHistoryDateTimePicker.svelte';
  import {
    createHistoryText,
    createHistoryMarkdown,
    createHistoryHtml,
    extractSafeLinks,
    dateTime,
    filterHistory,
    nameMap,
    normalizeHistoryItem,
    mergeHistory,
    parseHistoryBoundary,
    saveHistoryFile,
    sortedHistory,
    type ExportedMessage,
    type HistoryExportFormat,
    type HistoryCategory,
    type HistoryFilter,
  } from './room-history-export.js';

  // Remain inside the original RoomSearchPanel; only this compact launch
  // button sits in the search layout. Native showModal() moves the viewer
  // into the browser top layer, so it cannot widen/clamp the search panel.
  const source = getContext<RoomHistoryExportContext | undefined>(HISTORY_EXPORT_CONTEXT);
  const cache = new SvelteMap<string, ExportedMessage>();
  let records = $state<ExportedMessage[]>([]);
  const filters = $state<HistoryFilter>({
    query: '',
    senderId: '',
    after: '',
    before: '',
    category: 'all',
  });
  let busy = $state(false);
  let endReached = $state(false);
  let feedback = $state('');
  let pages = $state(0);
  let stop = $state(false);
  let visibleCount = $state(100);
  let disposed = false;
  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  let messageArea = $state<HTMLElement | undefined>(undefined);

  // sable-custom: restore chat-history export after media preview
  // The native <dialog> lives above the Sable media viewer's overlay. Temporarily
  // close it for media viewing, then reopen it with the same filters and scroll.
  let resumeHistoryAfterMedia = $state(false);
  let exportMediaViewerOpened = $state(false);
  let resumeHistoryScrollTop = 0;

  function openSableMediaAndRestoreExportDialog(eventId: string): void {
    if (!source) return;
    resumeHistoryScrollTop = messageArea?.scrollTop ?? 0;
    resumeHistoryAfterMedia = true;
    exportMediaViewerOpened = false;
    if (dialog?.open) dialog.close();
    source.openMedia(eventId);
  }

  $effect(() => {
    const viewerOpen = mediaViewerState.eventId !== null;
    if (!resumeHistoryAfterMedia) return;
    if (viewerOpen) {
      exportMediaViewerOpened = true;
      return;
    }
    if (!exportMediaViewerOpened) return;

    void (async () => {
      // The next task waits for Escape/close to finish; tick alone can run
      // before the browser has processed the key's default action.
      await tick();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (!resumeHistoryAfterMedia || mediaViewerState.eventId !== null || !dialog?.isConnected)
        return;
      try {
        if (!dialog.open) dialog.showModal();
        await tick();
        if (messageArea) messageArea.scrollTop = resumeHistoryScrollTop;
      } finally {
        resumeHistoryAfterMedia = false;
        exportMediaViewerOpened = false;
      }
    })();
  });
  let formatMenuOpen = $state(false);
  let queuedFormat = $state<HistoryExportFormat | null>(null);
  let automaticIncomplete = $state(false);
  const MAX_AUTO_PAGES = 5000;
  const L = {
    export: '\u5bfc\u51fa\u804a\u5929\u8bb0\u5f55',
    waiting:
      '\u5386\u53f2\u8bb0\u5f55\u6b63\u5728\u81ea\u52a8\u8bfb\u53d6\uff0c\u5b8c\u6210\u540e\u5c06\u81ea\u52a8\u5bfc\u51fa\u3002',
    loading: '\u6b63\u5728\u81ea\u52a8\u8bfb\u53d6\u5386\u53f2',
    done: '\u5386\u53f2\u8bfb\u53d6\u5b8c\u6210',
    partial: '\u5386\u53f2\u672a\u5b8c\u6574\uff0c\u4ec5\u5bfc\u51fa\u5df2\u8bfb\u53d6\u90e8\u5206',
    failed:
      '\u5386\u53f2\u81ea\u52a8\u8bfb\u53d6\u4e2d\u65ad\u3002\u53ef\u91cd\u65b0\u6253\u5f00\u7a97\u53e3\u7ee7\u7eed\u5c1d\u8bd5\uff0c\u6216\u5bfc\u51fa\u5df2\u8bfb\u53d6\u7684\u90e8\u5206\u3002',
    previewImage: '\u9884\u89c8\u56fe\u7247',
    previewVideo: '\u9884\u89c8\u89c6\u9891',
    viewFile: '\u67e5\u770b\u6587\u4ef6\u6d88\u606f',
    previewHint: '\u70b9\u51fb\u4f7f\u7528 Sable \u9884\u89c8',
    openLink: '\u6253\u5f00\u94fe\u63a5',
    loadedScope:
      '\u5df2\u8bfb\u53d6\u5386\u53f2\uff08\u6309\u5f53\u524d\u7b5b\u9009\u6761\u4ef6\uff09',
    partialScope:
      '\u53ea\u542b\u5f53\u524d\u5df2\u8bfb\u53d6\u7684\u90e8\u5206\u5386\u53f2\uff0c\u5e76\u975e\u5168\u91cf',
  } as const;

  let matching = $derived(filterHistory(records, filters));
  let visibleMessages = $derived(matching.slice(Math.max(0, matching.length - visibleCount)));
  let people = $derived(
    [...new Map(records.map((item) => [item.senderId, item.senderName] as const)).entries()].sort(
      (a, b) => a[1].localeCompare(b[1], 'zh-CN')
    )
  );
  const tabs: { id: HistoryCategory; label: string }[] = [
    { id: 'all', label: '全部' },
    { id: 'file', label: '文件' },
    { id: 'media', label: '图片与视频' },
    { id: 'link', label: '链接' },
  ];

  function gather(snapshot: readonly unknown[]): number {
    if (!source) return 0;
    const names = nameMap(source.members());
    const added: ExportedMessage[] = [];
    for (const value of snapshot) {
      const item = normalizeHistoryItem(value, names);
      if (!item || cache.has(item.eventId)) continue;
      cache.set(item.eventId, item);
      added.push(item);
    }
    if (added.length) records = mergeHistory(records, sortedHistory(added));
    return added.length;
  }

  $effect(() => {
    if (!source) return;
    gather([...source.timelineItems()]);
  });

  onDestroy(() => {
    disposed = true;
    stop = true;
  });

  async function openHistory(): Promise<void> {
    if (!source || !dialog || dialog.open) return;
    gather([...source.timelineItems()]);
    dialog.showModal();
    await tick();
    if (messageArea) messageArea.scrollTop = messageArea.scrollHeight;
    stop = false;
    void loadAll(); // automatic, cancellable on dialog close
  }

  function closeHistory(): void {
    stop = true;
    queuedFormat = null;
    formatMenuOpen = false;
    dialog?.close();
  }

  async function previewOriginal(eventId: string, media: boolean): Promise<void> {
    if (!source) return;
    const inTimeline = source
      .timelineItems()
      .some(
        (value) =>
          value !== null &&
          typeof value === 'object' &&
          ((value as { event_id?: string; eventId?: string }).event_id === eventId ||
            (value as { event_id?: string; eventId?: string }).eventId === eventId)
      );
    closeHistory();
    await tick();
    if (media && inTimeline) {
      openSableMediaAndRestoreExportDialog(eventId);
    } else {
      source.jumpToMessage(eventId);
    }
  }

  async function onRecordScroll(): Promise<void> {
    const panel = messageArea;
    if (!panel || panel.scrollTop > 80 || visibleCount >= matching.length) return;
    const heightBefore = panel.scrollHeight;
    visibleCount = Math.min(matching.length, visibleCount + 100);
    await tick();
    if (panel.isConnected) panel.scrollTop += panel.scrollHeight - heightBefore;
  }

  function dateCheck(): boolean {
    const after = filters.after ? parseHistoryBoundary(filters.after, false) : null;
    const before = filters.before ? parseHistoryBoundary(filters.before, true) : null;
    if ((filters.after && after === null) || (filters.before && before === null)) {
      feedback = '请选择有效的日期、小时和分钟。';
      return false;
    }
    if (after !== null && before !== null && after > before) {
      feedback = '开始时间不能晚于结束时间。';
      return false;
    }
    return true;
  }

  async function nextPage(): Promise<void> {
    if (!source || endReached) return;
    const more = await source.loadOlder(100);
    await tick();
    gather([...source.timelineItems()]);
    pages += 1;
    if (!more) endReached = true;
  }

  async function loadAll(): Promise<void> {
    if (busy || !source || endReached || pages >= MAX_AUTO_PAGES) return;
    busy = true;
    stop = false;
    automaticIncomplete = false;
    let stalled = 0;
    let lastAnnouncement = 0;
    try {
      while (dialog?.open && !stop && !disposed && !endReached && pages < MAX_AUTO_PAGES) {
        const count = cache.size;
        await nextPage();
        stalled = cache.size === count ? stalled + 1 : 0;
        if (stalled >= 20) {
          automaticIncomplete = true;
          break;
        }
        if (Date.now() - lastAnnouncement > 250) {
          feedback = `${L.loading}: ${cache.size} / ${pages} 页`;
          lastAnnouncement = Date.now();
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 65));
      }
      if (disposed || stop || !dialog?.open) return;
      if (endReached) {
        feedback = `${L.done}: ${cache.size} ${'\u6761'}`;
      } else if (pages >= MAX_AUTO_PAGES || automaticIncomplete) {
        automaticIncomplete = true;
        feedback = L.failed;
      }
    } catch (error) {
      console.warn('[sable history] auto loading failed', error);
      automaticIncomplete = true;
      feedback = L.failed;
    } finally {
      busy = false;
      if (endReached && queuedFormat && !disposed && !stop && dialog?.open) {
        const format = queuedFormat;
        queuedFormat = null;
        exportHistory(format);
      } else if (automaticIncomplete) {
        queuedFormat = null; // Never silently export a partial file as complete.
      }
    }
  }

  function exportHistory(format: HistoryExportFormat): void {
    if (!source || !dateCheck()) return;
    const items = filterHistory(sortedHistory(cache.values()), filters);
    if (!items.length) {
      feedback =
        '\u5f53\u524d\u7b5b\u9009\u6761\u4ef6\u4e0b\u6ca1\u6709\u804a\u5929\u8bb0\u5f55\u3002';
      return;
    }
    const scope = endReached ? L.loadedScope : L.partialScope;
    const roomName = source.roomName();
    const data =
      format === 'txt'
        ? createHistoryText(roomName, source.roomId(), items, scope)
        : format === 'md'
          ? createHistoryMarkdown(roomName, source.roomId(), items, scope)
          : createHistoryHtml(roomName, source.roomId(), items, scope);
    saveHistoryFile(roomName, format, data);
    feedback = `${endReached ? '' : `${L.partial}: `}${items.length} ${'\u6761'} ${format.toUpperCase()} ${'\u5df2\u5bfc\u51fa'}`;
  }

  function chooseFormat(format: HistoryExportFormat): void {
    formatMenuOpen = false;
    if (!dateCheck()) return;
    if (!endReached && !automaticIncomplete && pages < MAX_AUTO_PAGES) {
      queuedFormat = format;
      feedback = L.waiting;
      if (!busy) void loadAll();
      return;
    }
    // After a failed/limited crawl, a new click intentionally exports only
    // the collected records. Scope is explicit in both file and status line.
    exportHistory(format);
  }
</script>

{#if source}
  <div class="history-launch-container">
    <button
      type="button"
      class="history-launch"
      onclick={() => void openHistory()}
      title="查看及导出聊天记录"
      aria-label="查看及导出聊天记录">聊天记录</button
    >
  </div>

  <dialog
    bind:this={dialog}
    class="history-dialog"
    aria-labelledby="history-dialog-title"
    onclose={() => {
      stop = true;
      queuedFormat = null;
      formatMenuOpen = false;
    }}
  >
    <div class="dialog-grid">
      <header class="dialog-header">
        <div class="dialog-heading">
          <h2 id="history-dialog-title">聊天记录</h2>
          <span class="room-name">{source.roomName()}</span>
        </div>
        <button type="button" class="close-button" aria-label="关闭聊天记录" onclick={closeHistory}
          >×</button
        >
      </header>

      <div class="dialog-filters">
        <div class="category-tabs" role="group" aria-label="筛选消息类别">
          {#each tabs as tab (tab.id)}
            <button
              type="button"
              class:selected={filters.category === tab.id}
              aria-pressed={filters.category === tab.id}
              onclick={() => (filters.category = tab.id)}>{tab.label}</button
            >
          {/each}
        </div>
        <div class="search-filters">
          <label class="search-text"
            >搜索聊天记录
            <input type="search" placeholder="搜索发送者或消息内容" bind:value={filters.query} />
          </label>
          <label class="sender-field"
            >发送者
            <select bind:value={filters.senderId}>
              <option value="">全部成员</option>
              {#each people as [id, name] (id)}
                <option value={id}>{name}</option>
              {/each}
            </select>
          </label>
          <RoomHistoryDateTimePicker
            label="开始时间"
            value={filters.after}
            onChange={(next) => (filters.after = next)}
          />
          <RoomHistoryDateTimePicker
            label="结束时间"
            value={filters.before}
            onChange={(next) => (filters.before = next)}
            alignEnd
            upperBound
          />
        </div>
        <div class="history-stat">
          已载入 {records.length} 条 · 符合筛选条件 {matching.length} 条
          {#if !endReached}
            · 还有未读取的历史{:else}
            · 已达时间线边界{/if}
        </div>
      </div>

      <section
        class="message-area"
        bind:this={messageArea}
        onscroll={() => void onRecordScroll()}
        aria-label="聊天记录列表"
      >
        {#if matching.length === 0}
          <div class="empty-history">
            {records.length === 0
              ? '尚未收集到可显示的消息，正在自动读取历史。'
              : '当前筛选条件下没有聊天记录。'}
          </div>
        {:else}
          {#if matching.length > visibleMessages.length}
            <div class="history-scroll-hint">
              {matching.length - visibleMessages.length} 条较早记录，向上滚动即可查看
            </div>
          {/if}
          {#each visibleMessages as item (item.eventId)}
            <article class="history-message">
              <div class="message-heading">
                <strong title={item.senderId}>{item.senderName}</strong>
                <time>{dateTime(item.timestamp)}</time>
              </div>
              {#if item.category === 'image' || item.category === 'video'}
                <button
                  type="button"
                  class="media-preview"
                  onclick={() => void previewOriginal(item.eventId, true)}
                  aria-label={item.category === 'image' ? L.previewImage : L.previewVideo}
                >
                  <span class="preview-icon" aria-hidden="true"
                    >{item.category === 'image' ? '\u25a3' : '\u25b6'}</span
                  >
                  <span class="preview-description">
                    <strong>{item.category === 'image' ? L.previewImage : L.previewVideo}</strong>
                    <span class="preview-name">{item.body}</span>
                    <small>{L.previewHint}</small>
                  </span>
                </button>
              {:else if item.category === 'file'}
                <button
                  type="button"
                  class="media-preview file-preview"
                  onclick={() => void previewOriginal(item.eventId, false)}
                >
                  <span class="preview-icon" aria-hidden="true">▤</span>
                  <span class="preview-description"
                    ><strong>{L.viewFile}</strong><span class="preview-name">{item.body}</span
                    ></span
                  >
                </button>
              {:else}
                <div class="message-content">{item.body}</div>
              {/if}
              {#if (item.links ?? extractSafeLinks(item.body)).length}
                <div class="link-cards">
                  {#each item.links ?? extractSafeLinks(item.body) as link (link)}
                    <a
                      href={link}
                      target="_blank"
                      rel="external noopener noreferrer"
                      class="link-preview"
                      title={link}
                    >
                      <span class="link-icon" aria-hidden="true">↗</span>
                      <span><strong>{L.openLink}</strong><small>{link}</small></span>
                    </a>
                  {/each}
                </div>
              {/if}
            </article>
          {/each}
        {/if}
      </section>

      <footer class="dialog-footer">
        <div class="feedback-line" role="status" aria-live="polite">
          {feedback || '仅显示本客户端已载入且可读取的记录；图片、音视频和文件不下载附件。'}
        </div>
        <div class="dialog-actions">
          {#if busy}
            <span class="auto-loading" role="status">{L.loading} {records.length} / {pages} 页</span
            >
          {/if}
          <div class="format-menu-wrap">
            <button
              class="action primary"
              type="button"
              aria-expanded={formatMenuOpen}
              onclick={() => (formatMenuOpen = !formatMenuOpen)}>{L.export} ▾</button
            >
            {#if formatMenuOpen}
              <div class="format-menu" role="group" aria-label={L.export}>
                <button type="button" onclick={() => chooseFormat('txt')}>TXT (.txt)</button>
                <button type="button" onclick={() => chooseFormat('md')}>Markdown (.md)</button>
                <button type="button" onclick={() => chooseFormat('html')}>HTML (.html)</button>
              </div>
            {/if}
          </div>
        </div>
      </footer>
    </div>
  </dialog>
{/if}

<style>
  /* Native search-header action: never move DOM elements at runtime. */
  .history-launch-container {
    align-items: center;
    display: flex;
    min-width: 0;
  }

  .history-launch {
    align-items: center;
    background: var(--surface-var-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    color: var(--surface-on-container);
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    justify-content: center;
    max-width: 100%;
    padding: var(--space-100) var(--space-200);
    white-space: nowrap;
    width: auto;
  }

  .history-dialog {
    background: var(--surface-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    box-sizing: border-box;
    color: var(--surface-on-container);
    font: inherit;
    height: min(54rem, calc(100dvh - 2 * var(--space-400)));
    margin: auto;
    max-height: calc(100dvh - 2 * var(--space-400));
    max-width: calc(100vw - 2 * var(--space-400));
    overflow: visible;
    padding: 0;
    width: min(68rem, calc(100vw - 2 * var(--space-400)));
  }

  .history-dialog::backdrop {
    background: color-mix(in srgb, var(--surface-on-container) 42%, transparent);
  }

  .dialog-grid {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    height: 100%;
    min-width: 0;
  }

  .dialog-header {
    align-items: center;
    border-bottom: var(--border-width) solid var(--surface-container-line);
    display: flex;
    gap: var(--space-300);
    justify-content: space-between;
    padding: var(--space-300) var(--space-400);
  }

  .dialog-heading {
    align-items: baseline;
    display: flex;
    gap: var(--space-300);
    min-width: 0;
  }

  .dialog-heading h2 {
    font-size: var(--font-size-body);
    font-weight: 700;
    margin: 0;
  }

  .room-name {
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close-button {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: var(--space-100) var(--space-200);
  }

  .dialog-filters {
    border-bottom: var(--border-width) solid var(--surface-container-line);
    display: grid;
    gap: var(--space-200);
    padding: var(--space-200) var(--space-400);
    position: relative;
    z-index: 3;
  }

  .category-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-100);
  }

  .category-tabs button {
    background: transparent;
    border: 0;
    border-bottom: var(--border-width) solid transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: var(--space-100) var(--space-300);
  }

  .category-tabs button.selected {
    border-color: var(--primary-main);
    color: var(--primary-main);
  }

  .search-filters {
    align-items: end;
    display: grid;
    gap: var(--space-200);
    grid-template-columns: minmax(10rem, 1.5fr) repeat(3, minmax(8rem, 1fr));
  }

  .search-text,
  .sender-field {
    display: grid;
    font-size: var(--font-size-small);
    gap: var(--space-100);
    min-width: 0;
  }

  input,
  select {
    background: var(--surface-var-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    box-sizing: border-box;
    color: inherit;
    font: inherit;
    min-width: 0;
    padding: var(--space-200);
    width: 100%;
  }

  .history-stat {
    font-size: var(--font-size-small);
    opacity: 0.75;
  }

  .message-area {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: var(--space-300) var(--space-400);
  }

  .history-message {
    border-bottom: var(--border-width) solid var(--surface-container-line);
    overflow-wrap: anywhere;
    padding: var(--space-200) 0;
  }

  .message-heading {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-200);
    justify-content: space-between;
    margin-bottom: var(--space-100);
  }

  .message-heading strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .message-heading time {
    font-size: var(--font-size-small);
    opacity: 0.68;
  }

  .message-content {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .empty-history {
    opacity: 0.75;
    padding: var(--space-400);
    text-align: center;
  }

  .dialog-footer {
    border-top: var(--border-width) solid var(--surface-container-line);
    display: grid;
    gap: var(--space-200);
    padding: var(--space-200) var(--space-400);
    position: relative;
    z-index: 5;
  }

  .feedback-line {
    font-size: var(--font-size-small);
    opacity: 0.78;
    overflow-wrap: anywhere;
  }

  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-200);
    justify-content: flex-end;
  }

  .action {
    background: var(--surface-var-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: var(--space-200);
  }

  .action.primary {
    background: var(--primary-container);
    color: var(--primary-on-container);
  }

  .action:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  @media (width <= 55rem) {
    .search-filters {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (width <= 36rem) {
    .search-filters {
      grid-template-columns: minmax(0, 1fr);
    }

    .dialog-heading {
      display: block;
    }

    .history-dialog {
      height: calc(100dvh - 2 * var(--space-200));
      max-height: calc(100dvh - 2 * var(--space-200));
      max-width: calc(100vw - 2 * var(--space-200));
      width: calc(100vw - 2 * var(--space-200));
    }

    .dialog-filters {
      max-height: 45dvh;
      overflow-y: auto;
    }

    .dialog-actions {
      justify-content: flex-start;
    }
  }

  .history-scroll-hint {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    padding: var(--space-200);
    text-align: center;
  }

  .media-preview {
    align-items: center;
    background: var(--surface-var-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    color: inherit;
    cursor: pointer;
    display: flex;
    font: inherit;
    gap: var(--space-300);
    min-height: 6rem;
    padding: var(--space-300);
    text-align: start;
    width: min(100%, 30rem);
  }

  .preview-icon {
    background: var(--surface-container);
    border-radius: var(--radius);
    display: grid;
    flex: 0 0 5rem;
    font-size: var(--font-size-body);
    height: 4.8rem;
    place-items: center;
  }

  .preview-description {
    display: grid;
    gap: var(--space-100);
    min-width: 0;
  }

  .preview-description small {
    opacity: 0.7;
  }

  .preview-name {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .link-cards {
    display: grid;
    gap: var(--space-100);
    margin-top: var(--space-200);
  }

  .link-preview {
    align-items: center;
    background: var(--surface-var-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    box-sizing: border-box;
    color: var(--primary-main);
    display: flex;
    gap: var(--space-200);
    min-width: 0;
    padding: var(--space-200);
    text-decoration: none;
    width: min(100%, 34rem);
  }

  .media-preview:hover,
  .link-preview:hover {
    border-color: var(--primary-main);
  }

  .link-preview span:last-child {
    display: grid;
    gap: var(--space-100);
    min-width: 0;
  }

  .link-preview small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-icon {
    font-size: var(--font-size-body);
  }

  .auto-loading {
    align-self: center;
    font-size: var(--font-size-small);
    opacity: 0.8;
  }

  .format-menu-wrap {
    position: relative;
  }

  .format-menu {
    background: var(--surface-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    bottom: calc(100% + var(--space-100));
    box-shadow: 0 8px 25px color-mix(in srgb, var(--surface-on-container) 16%, transparent);
    display: grid;
    inset-inline-end: 0;
    min-width: 12rem;
    padding: var(--space-100);
    position: absolute;
    z-index: 6;
  }

  .format-menu button {
    background: transparent;
    border: 0;
    border-radius: var(--radius);
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: var(--space-200);
    text-align: start;
  }

  .format-menu button:hover {
    background: var(--surface-var-container);
  }
</style>
