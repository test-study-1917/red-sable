<script lang="ts">
  import { getContext, onDestroy, tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
  import type { HistoryPageCursor, TimelineItemView } from '#src/generated/protocol';
  import { startOfDay } from '#lib/day.js';
  import { holdOverlayBack } from '#lib/platform/overlay-back.svelte.js';
  import { scheduleInputs } from '#lib/features/composer/schedule-time.js';
  import { mediaViewerState } from '#lib/ui/media/media-viewer-state.svelte.js';
  import Select from '#lib/ui/primitives/Select.svelte';
  import Spinner from '#lib/ui/primitives/Spinner.svelte';
  import {
    HISTORY_EXPORT_CONTEXT,
    type RoomHistoryExportContext,
  } from './room-history-export-context.js';
  import RoomHistoryDateTimePicker from './RoomHistoryDateTimePicker.svelte';
  import {
    createHistoryText,
    createHistoryMarkdown,
    createHistoryHtml,
    dateTime,
    filterHistory,
    HistoryExportCache,
    nameMap,
    parseHistoryBoundary,
    saveHistoryFile,
    type ExportedMessage,
    type HistoryExportFormat,
    type HistoryCategory,
    type HistoryFilter,
  } from './room-history-export.js';

  let { browserBack = false }: { browserBack?: boolean } = $props();
  const compactDates = new MediaQuery('(width <= 36rem)');
  const filtersId = $props.id();
  let filtersExpanded = $state(false);
  let filterSummary = $state<HTMLButtonElement>();
  const filtersCollapsed = $derived(compactDates.current && !filtersExpanded);
  // Only the launcher takes space in the search header. The dialog opens in
  // the browser top layer, outside the search layout.
  const source = getContext<RoomHistoryExportContext | undefined>(HISTORY_EXPORT_CONTEXT);
  const loadedCache = new HistoryExportCache();
  let loadedRecords = $state.raw<readonly ExportedMessage[]>([]);
  let queryRecords = $state.raw<readonly ExportedMessage[]>([]);
  let queryMedia = $state.raw<readonly TimelineItemView[]>([]);
  const filters = $state<HistoryFilter>({
    query: '',
    senderId: '',
    after: '',
    before: '',
    category: 'all',
  });
  let result = $state<'loaded' | 'pending' | 'reading' | 'complete' | 'partial'>('loaded');
  let hasUndecryptableEvents = $state(false);
  let feedback = $state('');
  let requestId = 0;
  let visibleCount = $state(100);
  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  let historyOpen = $state(false);
  let messageArea = $state<HTMLElement | undefined>(undefined);
  let senderOptionsOpen = $state(false);
  let typeOptionsOpen = $state(false);

  holdOverlayBack(() => browserBack && historyOpen, closeHistory);
  holdOverlayBack(
    () => browserBack && historyOpen && (senderOptionsOpen || typeOptionsOpen),
    closeFilterOptions
  );

  $effect(() => {
    if (!historyOpen || !compactDates.current || filtersCollapsed) closeFilterOptions();
  });

  function closeFilterOptions(): void {
    senderOptionsOpen = false;
    typeOptionsOpen = false;
  }

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
    mediaViewerState.open(
      eventId,
      result === 'loaded' ? source.timelineItems : () => queryMedia,
      (target) => {
        closeHistory();
        source.jumpToMessage(target);
      }
    );
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
  const MAX_PAGES = 5000;
  const L = {
    previewImage: '预览图片',
    previewVideo: '预览视频',
    viewFile: '查看文件消息',
    previewHint: '点击使用 Sable 预览',
    openLink: '打开链接',
    loadedScope: '已读取历史（按当前筛选条件）',
    partialScope: '仅含已读取且符合筛选条件的记录',
    missingOlder: '较早的记录尚未读完',
    missingNewer: '尚未读到最新的记录',
    undecryptableEvents: '有加密事件无法解密，未纳入结果',
  } as const;

  const types: { value: HistoryCategory; label: string }[] = [
    { value: 'all', label: '全部消息' },
    { value: 'file', label: '文件' },
    { value: 'media', label: '图片与视频' },
    { value: 'link', label: '含链接' },
  ];
  let referenceDay = $state(startOfDay(Date.now()));
  let presets = $derived(
    [
      { label: '今天', firstDay: 0, lastDay: 0 },
      { label: '昨天', firstDay: -1, lastDay: -1 },
      { label: '最近 7 天', firstDay: -6, lastDay: 0 },
    ].map(({ label, firstDay, lastDay }) => ({
      label,
      after: `${scheduleInputs(startOfDay(referenceDay, firstDay)).date}T00:00`,
      before: `${scheduleInputs(startOfDay(referenceDay, lastDay)).date}T23:59`,
    }))
  );
  let hasDates = $derived(Boolean(filters.after || filters.before));
  const dateSummary = $derived.by(() => {
    const start = filters.after.replace('T', ' ');
    const end = filters.before.replace('T', ' ');
    if (!start && !end) return '不限日期';
    if (!start) return `截至 ${end}`;
    if (!end) return `从 ${start} 起`;
    return `${start} – ${start.slice(0, 10) === end.slice(0, 10) ? end.slice(11) : end}`;
  });
  const showCollapsedStatus = $derived(
    result === 'pending' || result === 'reading' || result === 'partial' || hasUndecryptableEvents
  );
  let records = $derived(result === 'loaded' ? loadedRecords : queryRecords);
  let matching = $derived(filterHistory(records, filters));
  let visibleMessages = $derived(matching.slice(Math.max(0, matching.length - visibleCount)));
  let people = $derived(
    [...new Map(records.map((item) => [item.senderId, item.senderName] as const)).entries()].sort(
      (a, b) => a[1].localeCompare(b[1], 'zh-CN')
    )
  );
  const senderOptions = $derived([
    { value: '', label: '全部成员' },
    ...(filters.senderId && !people.some(([id]) => id === filters.senderId)
      ? [{ value: filters.senderId, label: filters.senderId }]
      : []),
    ...people.map(([value, label]) => ({ value, label })),
  ]);
  let historyGaps = $derived(
    result === 'loaded'
      ? [!source?.reachesStart() && L.missingOlder, !source?.reachesLatest() && L.missingNewer]
          .filter(Boolean)
          .join('；')
      : result === 'partial'
        ? hasDates
          ? '所选时段未读完'
          : '全部历史未读完'
        : ''
  );
  let exportLabel = $derived(
    result === 'loaded'
      ? '导出已载入记录'
      : result === 'partial'
        ? '仅导出已读取结果'
        : `导出 ${matching.length} 条`
  );
  let canExport = $derived(result !== 'reading' && matching.length > 0);

  $effect(() => {
    if (source)
      loadedRecords = loadedCache.collect(source.timelineItems(), nameMap(source.members()));
  });

  onDestroy(() => {
    requestId += 1;
  });

  async function openHistory(): Promise<void> {
    if (!dialog || dialog.open) return;
    referenceDay = startOfDay(Date.now());
    filtersExpanded = false;
    dialog.showModal();
    historyOpen = true;
    await tick();
    if (messageArea) messageArea.scrollTop = messageArea.scrollHeight;
  }

  function stopReading(): void {
    if (result !== 'reading') return;
    requestId += 1;
    result = 'partial';
  }

  function closeHistory(): void {
    stopReading();
    historyOpen = false;
    resumeHistoryAfterMedia = false;
    formatMenuOpen = false;
    dialog?.close();
  }

  function previewOriginal(eventId: string, media: boolean): void {
    if (!source) return;
    const previewItems = result === 'loaded' ? source.timelineItems() : queryMedia;
    if (media && previewItems.some((item) => item.event_id === eventId)) {
      formatMenuOpen = false;
      openSableMediaAndRestoreExportDialog(eventId);
      return;
    }
    closeHistory();
    source.jumpToMessage(eventId);
  }

  async function onRecordScroll(): Promise<void> {
    const panel = messageArea;
    if (!panel || panel.scrollTop > 80 || visibleCount >= matching.length) return;
    const heightBefore = panel.scrollHeight;
    visibleCount = Math.min(matching.length, visibleCount + 100);
    await tick();
    if (panel.isConnected) panel.scrollTop += panel.scrollHeight - heightBefore;
  }

  function selectDates(after: string, before: string): void {
    referenceDay = startOfDay(Date.now());
    if (filters.after === after && filters.before === before) return;
    filters.after = after;
    filters.before = before;
    requestId += 1;
    queryRecords = [];
    queryMedia = [];
    hasUndecryptableEvents = false;
    result = after || before ? 'pending' : 'loaded';
    visibleCount = 100;
    feedback = '';
    formatMenuOpen = false;
  }

  function selectPreset(index: number): void {
    referenceDay = startOfDay(Date.now());
    selectDates(presets[index].after, presets[index].before);
    if (filtersCollapsed && result !== 'reading') void queryHistory();
  }

  async function queryHistory(): Promise<void> {
    if (!source) return;
    const after = filters.after ? parseHistoryBoundary(filters.after, false) : null;
    const before = filters.before ? parseHistoryBoundary(filters.before, true) : null;
    if ((filters.after && after === null) || (filters.before && before === null)) {
      feedback = '请选择有效的日期和时间。';
      return;
    }
    if (after !== null && before !== null && after > before) {
      feedback = '开始时间不能晚于结束时间。';
      return;
    }
    if (compactDates.current && filtersExpanded) {
      filtersExpanded = false;
      filterSummary?.focus();
    }
    const through = before ?? (after === null ? null : Date.now());
    const serial = ++requestId;
    const roomId = source.roomId();
    const cache = new HistoryExportCache();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- collects pages for one request; the UI reads the published array
    const media = new Map<string, TimelineItemView>();
    let cursor: HistoryPageCursor | null = null;
    queryRecords = [];
    queryMedia = [];
    hasUndecryptableEvents = false;
    result = 'reading';
    visibleCount = 100;
    feedback = '';
    formatMenuOpen = false;

    if (after !== null && through !== null && after > through) {
      result = 'complete';
      return;
    }
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await source.readPage({
          room_id: roomId,
          after: after === null ? null : Math.max(0, after),
          before: through === null ? null : Math.max(0, through),
          cursor,
        });
        if (serial !== requestId) return;
        hasUndecryptableEvents ||= response.has_undecryptable_events;
        queryRecords = cache.collect(response.items, nameMap(source.members()));
        for (const item of response.items) {
          if (!item.event_id) continue;
          if (
            item.content.kind === 'image' ||
            item.content.kind === 'sticker' ||
            item.content.kind === 'video'
          ) {
            media.set(item.event_id, item);
          }
          if (item.content.kind === 'redacted') media.delete(item.event_id);
        }
        queryMedia = [...media.values()].sort((a, b) => a.timestamp - b.timestamp);
        if (!response.cursor) {
          result = 'complete';
          return;
        }
        if (response.cursor.from === cursor?.from) break;
        cursor = response.cursor;
      }
      result = 'partial';
    } catch (error) {
      if (serial !== requestId) return;
      console.warn('[sable history] Could not read history', error);
      result = 'partial';
    }
  }

  function exportHistory(format: HistoryExportFormat): void {
    formatMenuOpen = false;
    if (!source || !canExport) return;
    const items = matching;
    const period = hasDates
      ? `${filters.after.replace('T', ' ') || '最早可读记录'} 至 ${filters.before.replace('T', ' ') || '查询时刻'}`
      : '';
    const partial = Boolean(historyGaps) || hasUndecryptableEvents;
    const scope = [
      partial ? L.partialScope : L.loadedScope,
      historyGaps,
      hasUndecryptableEvents && L.undecryptableEvents,
      period,
    ]
      .filter(Boolean)
      .join('；');
    const roomName = source.roomName();
    const data =
      format === 'txt'
        ? createHistoryText(roomName, source.roomId(), items, scope)
        : format === 'md'
          ? createHistoryMarkdown(roomName, source.roomId(), items, scope)
          : createHistoryHtml(roomName, source.roomId(), items, scope);
    saveHistoryFile(roomName, format, data);
    feedback = `已导出 ${items.length} 条 ${format.toUpperCase()}${partial ? '（部分历史）' : ''}`;
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
    oncancel={(event) => {
      if (senderOptionsOpen || typeOptionsOpen) {
        event.preventDefault();
        closeFilterOptions();
        return;
      }
      closeHistory();
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

      <div>
        {#if compactDates.current}
          <button
            bind:this={filterSummary}
            class="filter-summary"
            type="button"
            aria-controls={filtersId}
            aria-expanded={filtersExpanded}
            aria-label={`日期与筛选：${dateSummary}`}
            onclick={() => (filtersExpanded = !filtersExpanded)}
          >
            <span>{dateSummary}</span>
            <span class="summary-toggle">
              筛选
              <span class="summary-chevron" class:expanded={filtersExpanded} aria-hidden="true">
                <CaretDownIcon size={16} />
              </span>
            </span>
          </button>
          <div class="compact-date-actions">
            {@render datePresets()}
            {#if filtersExpanded}
              {@render queryAction()}
            {/if}
          </div>
        {/if}
        <div class="dialog-filters" class:collapsed={filtersCollapsed}>
          <div class="filter-fields" id={filtersId} hidden={filtersCollapsed}>
            {#if !filtersCollapsed}
              <div class="date-controls">
                {#if !compactDates.current}
                  {@render datePresets()}
                {/if}
                <div class="date-filters">
                  <RoomHistoryDateTimePicker
                    label="开始时间"
                    value={filters.after}
                    onChange={(next) => selectDates(next, filters.before)}
                  />
                  <RoomHistoryDateTimePicker
                    label="结束时间"
                    value={filters.before}
                    onChange={(next) => selectDates(filters.after, next)}
                    alignEnd
                    upperBound
                  />
                  {#if !compactDates.current}
                    {@render queryAction()}
                  {/if}
                </div>
              </div>
              <div class="search-filters">
                <label
                  >搜索聊天记录
                  <input
                    type="search"
                    placeholder="搜索发送者或消息内容"
                    bind:value={filters.query}
                  />
                </label>
                <label>
                  发送者
                  {#if compactDates.current && dialog}
                    <Select
                      aria-label="发送者"
                      items={senderOptions}
                      bind:value={filters.senderId}
                      bind:dropdownOpen={senderOptionsOpen}
                      portalTo={dialog}
                    />
                  {:else}
                    <select bind:value={filters.senderId}>
                      {#each senderOptions as sender (sender.value)}
                        <option value={sender.value}>{sender.label}</option>
                      {/each}
                    </select>
                  {/if}
                </label>
                <label>
                  消息类型
                  {#if compactDates.current && dialog}
                    <Select
                      aria-label="消息类型"
                      items={types}
                      bind:value={filters.category}
                      bind:dropdownOpen={typeOptionsOpen}
                      portalTo={dialog}
                    />
                  {:else}
                    <select bind:value={filters.category}>
                      {#each types as type (type.value)}
                        <option value={type.value}>{type.label}</option>
                      {/each}
                    </select>
                  {/if}
                </label>
              </div>
            {/if}
          </div>
          <div
            class="history-feedback"
            class:compact-status={filtersCollapsed && showCollapsedStatus}
          >
            <div
              class="history-stat"
              class:screen-reader-only={filtersCollapsed && !showCollapsedStatus}
              role="status"
            >
              {#if result === 'pending'}
                查询后显示所选时段的记录
              {:else if result === 'reading'}
                正在读取历史 · 已读取 {records.length} 条
              {:else if result === 'partial'}
                {historyGaps} · 符合筛选条件 {matching.length} 条
              {:else if result === 'complete'}
                查询完成 · {hasUndecryptableEvents ? '可读' : '共'}
                {records.length} 条{matching.length === records.length
                  ? ''
                  : ` · 符合筛选条件 ${matching.length} 条`}
              {:else}
                已载入 {records.length} 条 · 符合筛选条件 {matching.length} 条{historyGaps
                  ? ` · ${historyGaps}`
                  : ''}
              {/if}
              {hasUndecryptableEvents ? ` · ${L.undecryptableEvents}` : ''}
            </div>
            {#if filtersCollapsed && result === 'reading'}
              <button class="action compact-stop" type="button" onclick={stopReading}
                >停止读取</button
              >
            {/if}
          </div>
        </div>
      </div>

      <section
        class="message-area"
        bind:this={messageArea}
        onscroll={() => void onRecordScroll()}
        aria-label="聊天记录列表"
      >
        {#if matching.length === 0}
          {#if result !== 'pending' && result !== 'reading'}
            <div class="empty-history">
              {result === 'partial' && records.length === 0
                ? '尚未读取到记录，可重新查询。'
                : hasUndecryptableEvents
                  ? '当前筛选条件下没有可显示的聊天记录。'
                  : '当前筛选条件下没有聊天记录。'}
            </div>
          {/if}
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
                  onclick={() => previewOriginal(item.eventId, true)}
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
                  onclick={() => previewOriginal(item.eventId, false)}
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
              {#if item.links.length}
                <div class="link-cards">
                  {#each item.links as link (link)}
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
        <div class="feedback-line" role="status">{feedback}</div>
        <div class="dialog-actions">
          <div class="format-menu-wrap">
            <button
              class="action primary"
              type="button"
              disabled={!canExport}
              aria-expanded={formatMenuOpen && canExport}
              onclick={() => (formatMenuOpen = !formatMenuOpen)}>{exportLabel} ▾</button
            >
            {#if formatMenuOpen && canExport}
              <div class="format-menu" role="group" aria-label="导出格式">
                <button type="button" onclick={() => exportHistory('txt')}>TXT (.txt)</button>
                <button type="button" onclick={() => exportHistory('md')}>Markdown (.md)</button>
                <button type="button" onclick={() => exportHistory('html')}>HTML (.html)</button>
              </div>
            {/if}
          </div>
        </div>
      </footer>
    </div>
  </dialog>
{/if}

{#snippet datePresets()}
  <div class="date-presets" role="group" aria-label="快捷日期">
    {#each presets as preset, index (preset.label)}
      <button
        class="action choice"
        type="button"
        aria-pressed={filters.after === preset.after && filters.before === preset.before}
        onclick={() => selectPreset(index)}>{preset.label}</button
      >
    {/each}
  </div>
{/snippet}

{#snippet queryAction()}
  <button
    class="action query-action"
    class:primary={hasDates && result !== 'reading'}
    type="button"
    onclick={result === 'reading' ? stopReading : () => void queryHistory()}
  >
    {#if result === 'reading'}
      <Spinner small />
      停止读取
    {:else}
      {hasDates ? '查询' : '读取全部历史'}
    {/if}
  </button>
{/snippet}

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

  .filter-summary {
    align-items: center;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    display: flex;
    font: inherit;
    gap: var(--space-200);
    justify-content: space-between;
    min-height: var(--control-height-touch);
    padding: var(--space-100) var(--space-400);
    text-align: start;
    width: 100%;
  }

  .filter-summary:active {
    background: var(--surface-var-container-active);
  }

  .summary-toggle {
    align-items: center;
    display: inline-flex;
    flex: 0 0 auto;
    gap: var(--space-100);
  }

  .summary-chevron {
    display: inline-flex;
    flex: 0 0 auto;
  }

  .summary-chevron.expanded {
    rotate: 180deg;
  }

  .dialog-filters {
    border-bottom: var(--border-width) solid var(--surface-container-line);
    display: grid;
    gap: var(--space-200);
    padding: var(--space-200) var(--space-400);
    position: relative;
    z-index: 3;
  }

  .dialog-filters.collapsed {
    padding-block: 0;
  }

  .filter-fields {
    display: grid;
    gap: var(--space-200);
  }

  .filter-fields[hidden] {
    display: none;
  }

  .history-feedback.compact-status {
    align-items: center;
    display: flex;
    gap: var(--space-100);
    justify-content: space-between;
    padding-block-end: var(--space-200);
  }

  .date-controls,
  .date-presets,
  .date-filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-200);
  }

  .date-presets {
    gap: var(--space-100);
  }

  .date-filters {
    flex: 1 1 36rem;
    min-width: 0;
  }

  .search-filters {
    align-items: end;
    display: grid;
    gap: var(--space-200);
    grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));
  }

  .search-filters label {
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

  .compact-stop {
    flex: 0 0 auto;
    font-size: var(--font-size-small);
    padding: var(--space-100) var(--space-200);
  }

  .date-presets .choice[aria-pressed='true'] {
    border-color: var(--primary-main);
  }

  .query-action {
    align-items: center;
    display: inline-flex;
    gap: var(--space-100);
  }

  :is(.date-controls, .compact-date-actions) .action:hover {
    background: var(--surface-var-container-hover);
  }

  :is(.date-controls, .compact-date-actions) .action:active {
    background: var(--surface-var-container-active);
    transition: none;
  }

  :is(.date-controls, .compact-date-actions) .action:is(.primary, [aria-pressed='true']):hover {
    background: var(--primary-container-hover);
  }

  :is(.date-controls, .compact-date-actions) .action:is(.primary, [aria-pressed='true']):active {
    background: var(--primary-container-active);
  }

  @media (width <= 36rem) {
    .compact-date-actions {
      align-items: stretch;
      display: grid;
      gap: var(--space-200);
      grid-template-columns: minmax(0, 1fr) max-content;
      padding: var(--space-200) var(--space-400);
    }

    .date-presets {
      flex-wrap: nowrap;
    }

    .compact-date-actions .action {
      font-size: var(--font-size-small);
      white-space: nowrap;
    }

    .compact-date-actions .choice[aria-pressed='true'] {
      background: var(--primary-container);
      color: var(--primary-on-container);
    }

    .query-action {
      box-sizing: border-box;
      inline-size: max(6rem, calc(6em + 2 * var(--space-200) + 2 * var(--border-width)));
      justify-content: center;
    }

    .date-filters {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .search-filters {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .search-filters > :first-child {
      grid-column: 1 / -1;
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
      padding-block-start: 0;
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

  @media (width <= 36rem) {
    .format-menu {
      inset-inline: 0 auto;
    }
  }
</style>
