<script lang="ts">
  import { getContext, onDestroy, tick } from 'svelte';
  import { HISTORY_EXPORT_CONTEXT, type RoomHistoryExportContext } from './room-history-export-context.js';
  import RoomHistoryDateTimePicker from './RoomHistoryDateTimePicker.svelte';
  import {
    createHistoryText,
    dateTime,
    filterHistory,
    nameMap,
    normalizeHistoryItem,
    parseHistoryBoundary,
    saveHistoryText,
    sortedHistory,
    type ExportedMessage,
    type HistoryCategory,
    type HistoryFilter,
  } from './room-history-export.js';

  // Remain inside the original RoomSearchPanel; only this compact launch
  // button sits in the search layout. Native showModal() moves the viewer
  // into the browser top layer, so it cannot widen/clamp the search panel.
  const source = getContext<RoomHistoryExportContext | undefined>(HISTORY_EXPORT_CONTEXT);
  const cache = new Map<string, ExportedMessage>();
  let records = $state<ExportedMessage[]>([]);
  let filters = $state<HistoryFilter>({ query: '', senderId: '', after: '', before: '', category: 'all' });
  let busy = $state(false);
  let endReached = $state(false);
  let feedback = $state('');
  let pages = $state(0);
  let stop = $state(false);
  let visibleCount = $state(100);
  let disposed = false;
  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  let messageArea = $state<HTMLElement | undefined>(undefined);

  let matching = $derived(filterHistory(records, filters));
  let visibleMessages = $derived(matching.slice(Math.max(0, matching.length - visibleCount)));
  let people = $derived(
    [...new Map(records.map((item) => [item.senderId, item.senderName] as const)).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
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
    let added = 0;
    for (const value of snapshot) {
      const item = normalizeHistoryItem(value, names);
      if (!item || cache.has(item.eventId)) continue;
      cache.set(item.eventId, item);
      added += 1;
    }
    if (added) records = sortedHistory(cache.values());
    return added;
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
  }

  function closeHistory(): void {
    stop = true;
    dialog?.close();
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

  async function loadEarlier(): Promise<void> {
    if (busy || !source || endReached) return;
    busy = true;
    feedback = '';
    try {
      const count = cache.size;
      await nextPage();
      feedback = endReached
        ? `已到达客户端时间线的历史边界，共收集 ${cache.size} 条。`
        : `已新增 ${cache.size - count} 条消息，当前共 ${cache.size} 条。`;
    } catch (error) {
      console.warn('[sable history] loading older events failed', error);
      feedback = '加载更早记录失败；仍可查看或导出已收集部分。';
    } finally {
      busy = false;
    }
  }

  async function loadAll(): Promise<void> {
    if (busy || !source) return;
    busy = true;
    stop = false;
    let stalled = 0;
    try {
      while (!stop && !disposed && !endReached && pages < 5000) {
        const count = cache.size;
        await nextPage();
        stalled = cache.size === count ? stalled + 1 : 0;
        if (stalled >= 3) {
          feedback = '连续三页没有发现新消息，已暂停。请检查是否真正到达历史边界。';
          break;
        }
        feedback = `加载历史中：${cache.size} 条 / ${pages} 页。`;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
      }
      if (stop && !disposed) feedback = '已停止读取；可以导出已收集的部分。';
      else if (endReached) feedback = `已加载至客户端历史边界，共 ${cache.size} 条。`;
      else if (pages >= 5000) feedback = '已达到 5000 页保护上限；只能导出已读取部分。';
    } catch (error) {
      console.warn('[sable history] loading all failed', error);
      feedback = '历史加载中断，无法确认完整性；可导出已收集部分。';
    } finally {
      busy = false;
    }
  }

  function download(): void {
    if (!source || !dateCheck()) return;
    const items = filterHistory(sortedHistory(cache.values()), filters);
    if (!items.length) {
      feedback = '当前筛选条件下没有可导出的聊天记录。';
      return;
    }
    const scope = endReached
      ? '客户端时间线已达历史边界（按条件筛选）'
      : '当前客户端已加载的部分历史（按条件筛选，非全量）';
    const roomName = source.roomName();
    saveHistoryText(roomName, createHistoryText(roomName, source.roomId(), items, scope));
    feedback = `已导出 ${items.length} 条 TXT。文件包含明文聊天内容，请妥善保管。`;
  }

  async function downloadAll(): Promise<void> {
    if (!dateCheck() || !source || busy) return;
    await loadAll();
    if (disposed || !endReached || stop) return;
    download();
  }
</script>

{#if source}
  <div class="history-launch-container">
    <button type="button" class="history-launch" onclick={() => void openHistory()}>聊天记录与导出</button>
  </div>

  <dialog
    bind:this={dialog}
    class="history-dialog"
    aria-labelledby="history-dialog-title"
    onclose={() => (stop = true)}
  >
    <div class="dialog-grid">
      <header class="dialog-header">
        <div class="dialog-heading">
          <h2 id="history-dialog-title">聊天记录</h2>
          <span class="room-name">{source.roomName()}</span>
        </div>
        <button type="button" class="close-button" aria-label="关闭聊天记录" onclick={closeHistory}>×</button>
      </header>

      <div class="dialog-filters">
        <div class="category-tabs" role="group" aria-label="筛选消息类别">
          {#each tabs as tab (tab.id)}
            <button
              type="button"
              class:selected={filters.category === tab.id}
              aria-pressed={filters.category === tab.id}
              onclick={() => (filters.category = tab.id)}
            >{tab.label}</button>
          {/each}
        </div>
        <div class="search-filters">
          <label class="search-text">搜索聊天记录
            <input type="search" placeholder="搜索发送者或消息内容" bind:value={filters.query} />
          </label>
          <label class="sender-field">发送者
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
          {#if !endReached} · 还有未读取的历史{:else} · 已达时间线边界{/if}
        </div>
      </div>

      <section class="message-area" bind:this={messageArea} aria-label="聊天记录列表">
        {#if matching.length === 0}
          <div class="empty-history">
            {records.length === 0 ? '尚未收集到可显示的消息，可尝试加载更早记录。' : '当前筛选条件下没有聊天记录。'}
          </div>
        {:else}
          {#if matching.length > visibleMessages.length}
            <button type="button" class="show-older" onclick={() => (visibleCount += 100)}>
              显示更早的 {Math.min(100, matching.length - visibleMessages.length)} 条已加载记录
            </button>
          {/if}
          {#each visibleMessages as item (item.eventId)}
            <article class="history-message">
              <div class="message-heading">
                <strong title={item.senderId}>{item.senderName}</strong>
                <time>{dateTime(item.timestamp)}</time>
              </div>
              <div class="message-content">
                {#if item.category === 'image'}<span class="media-tag">[图片]</span>{/if}
                {#if item.category === 'video'}<span class="media-tag">[视频]</span>{/if}
                {#if item.category === 'file'}<span class="media-tag">[文件]</span>{/if}
                {item.body}
              </div>
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
            <button type="button" class="action" disabled={stop} onclick={() => (stop = true)}>停止加载</button>
          {:else}
            <button type="button" class="action" disabled={endReached} onclick={() => void loadEarlier()}>加载更早记录</button>
            <button type="button" class="action" onclick={download}>导出当前筛选 TXT</button>
            <button type="button" class="action primary" disabled={endReached} onclick={() => void downloadAll()}>加载全部后导出</button>
          {/if}
        </div>
      </footer>
    </div>
  </dialog>
{/if}

<style>
  .history-launch-container { display: flex; align-items: center; flex: 0 0 auto; min-width: 0; padding: var(--space-100) var(--space-200); }
  .history-launch {
    display: inline-flex; align-items: center; width: auto; max-width: 100%; cursor: pointer;
    background: var(--surface-var-container); color: var(--surface-on-container);
    border: var(--border-width) solid var(--surface-container-line); border-radius: var(--radius);
    padding: var(--space-100) var(--space-200); font: inherit;
  }
  .history-dialog {
    box-sizing: border-box; width: min(68rem, calc(100vw - 2 * var(--space-400)));
    max-width: calc(100vw - 2 * var(--space-400));
    height: min(54rem, calc(100dvh - 2 * var(--space-400)));
    max-height: calc(100dvh - 2 * var(--space-400));
    margin: auto; padding: 0;
    background: var(--surface-container); color: var(--surface-on-container);
    font: inherit; border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius); overflow: visible;
  }
  .history-dialog::backdrop { background: color-mix(in srgb, var(--surface-on-container) 42%, transparent); }
  .dialog-grid { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; height: 100%; min-width: 0; }
  .dialog-header { display: flex; justify-content: space-between; align-items: center; gap: var(--space-300); padding: var(--space-300) var(--space-400); border-bottom: var(--border-width) solid var(--surface-container-line); }
  .dialog-heading { display: flex; align-items: baseline; gap: var(--space-300); min-width: 0; }
  .dialog-heading h2 { margin: 0; font-size: var(--font-size-body); font-weight: 700; }
  .room-name { opacity: .7; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .close-button { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: var(--space-100) var(--space-200); }
  .dialog-filters { position: relative; z-index: 3; display: grid; gap: var(--space-200); padding: var(--space-200) var(--space-400); border-bottom: var(--border-width) solid var(--surface-container-line); }
  .category-tabs { display: flex; flex-wrap: wrap; gap: var(--space-100); }
  .category-tabs button { font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer; border-bottom: var(--border-width) solid transparent; padding: var(--space-100) var(--space-300); }
  .category-tabs button.selected { border-color: var(--primary-main); color: var(--primary-main); }
  .search-filters { display: grid; grid-template-columns: minmax(10rem, 1.5fr) repeat(3, minmax(8rem, 1fr)); gap: var(--space-200); align-items: end; }
  .search-text, .sender-field { display: grid; gap: var(--space-100); min-width: 0; font-size: var(--font-size-small); }
  input, select {
    min-width: 0; width: 100%; box-sizing: border-box; color: inherit; font: inherit;
    background: var(--surface-var-container); border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius); padding: var(--space-200);
  }
  .history-stat { font-size: var(--font-size-small); opacity: .75; }
  .message-area { min-height: 0; overflow: auto; padding: var(--space-300) var(--space-400); overscroll-behavior: contain; }
  .history-message { padding: var(--space-200) 0; border-bottom: var(--border-width) solid var(--surface-container-line); overflow-wrap: anywhere; }
  .message-heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-200); align-items: baseline; margin-bottom: var(--space-100); }
  .message-heading strong { min-width: 0; overflow-wrap: anywhere; }
  .message-heading time { opacity: .68; font-size: var(--font-size-small); }
  .message-content { white-space: pre-wrap; overflow-wrap: anywhere; }
  .media-tag { opacity: .7; margin-right: var(--space-100); }
  .empty-history { padding: var(--space-400); text-align: center; opacity: .75; }
  .show-older { display: block; margin: 0 auto var(--space-300); padding: var(--space-200); color: inherit; cursor: pointer; background: var(--surface-var-container); border: var(--border-width) solid var(--surface-container-line); border-radius: var(--radius); }
  .dialog-footer { display: grid; gap: var(--space-200); padding: var(--space-200) var(--space-400); border-top: var(--border-width) solid var(--surface-container-line); }
  .feedback-line { font-size: var(--font-size-small); opacity: .78; overflow-wrap: anywhere; }
  .dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-200); }
  .action { background: var(--surface-var-container); color: inherit; border: var(--border-width) solid var(--surface-container-line); border-radius: var(--radius); cursor: pointer; font: inherit; padding: var(--space-200); }
  .action.primary { background: var(--primary-container); color: var(--primary-on-container); }
  .action:disabled { cursor: not-allowed; opacity: .5; }
  @media (max-width: 55rem) {
    .search-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 36rem) {
    .search-filters { grid-template-columns: minmax(0, 1fr); }
    .dialog-heading { display: block; }
    .history-dialog { width: calc(100vw - 2 * var(--space-200)); max-width: calc(100vw - 2 * var(--space-200)); height: calc(100dvh - 2 * var(--space-200)); max-height: calc(100dvh - 2 * var(--space-200)); }
    .dialog-filters { max-height: 45dvh; overflow-y: auto; }
    .dialog-actions { justify-content: flex-start; }
  }
</style>
