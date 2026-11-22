/**
 * Client-side, plaintext-only Matrix room history exporter.
 * It deliberately never uploads events or downloads media attachments.
 */
export interface ExportedMessage {
  eventId: string;
  timestamp: number | null;
  senderId: string;
  senderName: string;
  body: string;
  category: 'message' | 'file' | 'image' | 'video';
  hasLink: boolean;
  links: string[];
}

export type HistoryCategory = 'all' | 'file' | 'media' | 'link';

export interface HistoryFilter {
  query: string;
  senderId: string;
  after: string;
  before: string;
  category: HistoryCategory;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{10,16}$/.test(value)) return Number(value);
  return null;
}

function timestamp(value: unknown): number | null {
  const time = number(value);
  if (time !== null) return time > 0 && time < 10_000_000_000 ? time * 1000 : time;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function senderIdOf(item: Record<string, unknown>): string {
  const sender = item.sender;
  return (
    string(item.sender_id) ??
    string(item.user_id) ??
    string(sender) ??
    string(record(sender).user_id) ??
    string(record(sender).id) ??
    '未知发送者'
  );
}

function categoryOf(content: Record<string, unknown>): ExportedMessage['category'] {
  const embedded = record(content.message);
  const media = record(content.media);
  const nested = record(embedded.content);
  const nestedMedia = record(embedded.media);
  const contentNested = record(content.content);
  const mime = (
    string(content.mimetype) ??
    string(media.mimetype) ??
    string(nestedMedia.mimetype) ??
    string(record(content.info).mimetype) ??
    string(record(embedded.info).mimetype) ??
    ''
  ).toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'file';
  const kinds = [
    content.msgtype,
    content.message_type,
    embedded.msgtype,
    embedded.kind,
    embedded.type,
    nested.msgtype,
    nested.kind,
    media.kind,
    media.type,
    nestedMedia.kind,
    nestedMedia.type,
    contentNested.msgtype,
    contentNested.kind,
    content.type,
    content.kind,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (/(?:^|[. _])image|photo|sticker/.test(kinds)) return 'image';
  if (/(?:^|[. _])video|movie/.test(kinds)) return 'video';
  if (/(?:^|[. _])file|audio|voice|attachment/.test(kinds)) return 'file';
  return 'message';
}

/** Return null for non-message timeline entries (day dividers, state events, etc.). */
export function normalizeHistoryItem(
  value: unknown,
  names: ReadonlyMap<string, string> = new Map()
): ExportedMessage | null {
  const change = historyChange(value, names);
  return change && !('redacted' in change) ? change : null;
}

function historyChange(
  value: unknown,
  names: ReadonlyMap<string, string>
): ExportedMessage | { eventId: string; redacted: true } | null {
  const item = record(value);
  const eventId = string(item.event_id) ?? string(item.eventId);
  if (!eventId) return null;
  const content = record(item.content);
  const kind = string(content.kind) ?? '';
  if (kind === 'redacted') return { eventId, redacted: true };
  // Export message-like content only; do not write a state/receipt event as a chat message.
  if (['state_event', 'read_receipt', 'divider', 'date', 'membership'].includes(kind)) return null;
  const embedded = record(content.message);
  const plainBody =
    (kind === 'message' && typeof content.body === 'string'
      ? content.body
      : string(content.body)) ??
    string(embedded.body) ??
    string(record(embedded.content).body) ??
    string(embedded.filename) ??
    string(content.caption) ??
    string(content.filename) ??
    string(record(content.media).filename) ??
    string(record(embedded.media).filename) ??
    string(record(content.content).body) ??
    string(content.formatted_body) ??
    string(item.body);
  const category = categoryOf(content);
  if (plainBody === null && category === 'message') return null;
  const body =
    plainBody ?? (category === 'image' ? '[图片]' : category === 'video' ? '[视频]' : '[文件]');
  const links = extractSafeLinks(body);
  const senderId = senderIdOf(item);
  const timestampValue =
    item.timestamp ?? item.ts ?? item.origin_server_ts ?? item.server_ts ?? item.sent_at ?? null;
  return {
    eventId,
    timestamp: timestamp(timestampValue),
    senderId,
    senderName:
      string(item.sender_name) ??
      string(item.display_name) ??
      string(record(item.sender).display_name) ??
      names.get(senderId) ??
      senderId,
    body,
    category,
    hasLink: links.length > 0,
    links,
  };
}

/** Only render/copy explicitly HTTP(S) links. Never make an mxc:// URL public. */
export function extractSafeLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'\p{Cc}]+/giu) ?? [];
  const output: string[] = [];
  for (const match of matches) {
    const clean = match.replace(/[.,;:!?\])\uff0c\u3002\uff01\uff1f\uff09]+$/g, '');
    try {
      const url = new URL(clean);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !output.includes(url.href)) {
        output.push(url.href);
      }
    } catch {
      /* Malformed link: render body as plain text only. */
    }
    if (output.length >= 20) break;
  }
  return output;
}

export function historyPermalink(roomId: string, eventId: string): string {
  return `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`;
}

export function nameMap(members: readonly unknown[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const value of members) {
    const member = record(value);
    const id = string(member.user_id);
    const name = string(member.display_name);
    if (id && name) names.set(id, name);
  }
  return names;
}

function historyCompare(a: ExportedMessage, b: ExportedMessage): number {
  return (a.timestamp ?? 0) - (b.timestamp ?? 0) || a.eventId.localeCompare(b.eventId);
}

export function sortedHistory(items: Iterable<ExportedMessage>): ExportedMessage[] {
  return [...items].sort(historyCompare);
}

/** Efficient O(n + m) merge after each history pagination batch. */
export function mergeHistory(
  existing: readonly ExportedMessage[],
  incoming: readonly ExportedMessage[]
): ExportedMessage[] {
  const merged: ExportedMessage[] = [];
  let i = 0;
  let j = 0;
  while (i < existing.length && j < incoming.length) {
    merged.push(historyCompare(existing[i], incoming[j]) <= 0 ? existing[i++] : incoming[j++]);
  }
  while (i < existing.length) merged.push(existing[i++]);
  while (j < incoming.length) merged.push(incoming[j++]);
  return merged;
}

export class HistoryExportCache {
  readonly #items = new Map<string, ExportedMessage | null>();
  #records: readonly ExportedMessage[] = [];

  collect(
    snapshot: readonly unknown[],
    names: ReadonlyMap<string, string>
  ): readonly ExportedMessage[] {
    const changed = new Set<string>();
    let replacesRecords = false;
    for (const value of snapshot) {
      const item = historyChange(value, names);
      if (!item) continue;
      const previous = this.#items.get(item.eventId);
      if (previous === null) continue; // A later window can still contain a stale copy.
      if ('redacted' in item) {
        this.#items.set(item.eventId, null);
        if (previous) {
          changed.add(item.eventId);
          replacesRecords = true;
        }
        continue;
      }
      if (
        previous &&
        previous.timestamp === item.timestamp &&
        previous.senderId === item.senderId &&
        previous.senderName === item.senderName &&
        previous.body === item.body &&
        previous.category === item.category
      )
        continue;
      this.#items.set(item.eventId, item);
      changed.add(item.eventId);
      if (previous) replacesRecords = true;
    }
    if (changed.size === 0) return this.#records;
    const incoming: ExportedMessage[] = [];
    for (const eventId of changed) {
      const item = this.#items.get(eventId);
      if (item) incoming.push(item);
    }
    this.#records = mergeHistory(
      replacesRecords ? this.#records.filter((item) => !changed.has(item.eventId)) : this.#records,
      sortedHistory(incoming)
    );
    return this.#records;
  }
}

/**
 * Parse a local date or local date-time. The lower bound is inclusive at :00.000,
 * and the upper bound includes every second in the selected minute (:59.999).
 * Returns null for empty or invalid input; callers validate nonempty values first.
 */
export function parseHistoryBoundary(value: string, upper: boolean): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hourPart = match.at(4);
  const minutePart = match.at(5);
  const hour = hourPart === undefined ? (upper ? 23 : 0) : Number(hourPart);
  const minute = minutePart === undefined ? (upper ? 59 : 0) : Number(minutePart);
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59)
    return null;
  const parsed = new Date(year, month - 1, day, hour, minute, upper ? 59 : 0, upper ? 999 : 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  )
    return null;
  return parsed.getTime();
}

export function filterHistory(
  items: readonly ExportedMessage[],
  filters: HistoryFilter
): ExportedMessage[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const after = filters.after ? parseHistoryBoundary(filters.after, false) : null;
  const before = filters.before ? parseHistoryBoundary(filters.before, true) : null;
  return items.filter((item) => {
    if (filters.senderId && item.senderId !== filters.senderId) return false;
    if (
      query &&
      !`${item.senderName} ${item.senderId} ${item.body}`.toLocaleLowerCase().includes(query)
    ) {
      return false;
    }
    if (after !== null && (item.timestamp === null || item.timestamp < after)) return false;
    if (before !== null && (item.timestamp === null || item.timestamp > before)) return false;
    if (filters.category === 'file' && item.category !== 'file') return false;
    if (filters.category === 'media' && item.category !== 'image' && item.category !== 'video')
      return false;
    if (filters.category === 'link' && !item.hasLink) return false;
    return true;
  });
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dateTime(time: number | null): string {
  if (time === null || !Number.isFinite(time)) return '时间未知';
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function createHistoryText(
  roomName: string,
  roomId: string,
  entries: readonly ExportedMessage[],
  scope: string
): string {
  const out: string[] = [
    '消息记录（由 Sable 导出；此文件包含明文聊天内容，请妥善保存）',
    '============================================================',
    `消息分组：Matrix`,
    `消息对象：${roomName}`,
    `房间 ID：${roomId}`,
    `导出时间：${dateTime(Date.now())}`,
    `记录范围：${scope}`,
    `消息数量：${entries.length}`,
    '============================================================',
    '',
  ];
  for (const entry of entries) {
    out.push(`${dateTime(entry.timestamp)}  ${entry.senderName} (${entry.senderId})`);
    const kindLabel =
      entry.category === 'image'
        ? '[图片] '
        : entry.category === 'video'
          ? '[视频] '
          : entry.category === 'file'
            ? '[文件] '
            : '';
    out.push(kindLabel + entry.body);
    if (entry.category !== 'message')
      out.push(`\u5a92\u4f53\u6d88\u606f: ${historyPermalink(roomId, entry.eventId)}`);
    out.push('');
  }
  return out.join('\r\n');
}

export function saveHistoryText(roomName: string, text: string): void {
  const filename = `${roomName.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').slice(0, 70) || 'matrix-room'}-聊天记录-${new Date().toISOString().slice(0, 10)}.txt`;
  const blob = new Blob(['\ufeff', text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
}

export type HistoryExportFormat = 'txt' | 'md' | 'html';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] ?? char
  );
}

function markdownFence(body: string): string {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((run) => run[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function markdownHeading(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|>~-]/g, '\\$&')
    .replace(/\r?\n/g, ' ');
}

export function createHistoryMarkdown(
  roomName: string,
  roomId: string,
  entries: readonly ExportedMessage[],
  scope: string
): string {
  const lines = [
    `# ${markdownHeading(roomName)} - \u804a\u5929\u8bb0\u5f55`,
    '',
    `- Matrix \u623f\u95f4: \`${roomId.replace(/`/g, '')}\``,
    `- \u5bfc\u51fa\u65f6\u95f4: ${dateTime(Date.now())}`,
    `- \u8bb0\u5f55\u8303\u56f4: ${markdownHeading(scope)}`,
    `- \u8bb0\u5f55\u6570\u91cf: ${entries.length}`,
    '',
    '---',
    '',
  ];
  for (const entry of entries) {
    const label =
      entry.category === 'image'
        ? '[\u56fe\u7247] '
        : entry.category === 'video'
          ? '[\u89c6\u9891] '
          : entry.category === 'file'
            ? '[\u6587\u4ef6] '
            : '';
    lines.push(`### ${dateTime(entry.timestamp)} - ${markdownHeading(entry.senderName)}`, '');
    lines.push(`\`${entry.senderId.replace(/`/g, '')}\``, '');
    const body = label + entry.body;
    const fence = markdownFence(body);
    lines.push(fence, body, fence, '');
    for (const link of entry.links) {
      lines.push(`- \u94fe\u63a5: <${link.replace(/>/g, '%3E')}>`);
    }
    if (entry.category !== 'message') {
      lines.push(
        `- [\u67e5\u770b\u5a92\u4f53\u539f\u6d88\u606f](${historyPermalink(roomId, entry.eventId)})`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function createHistoryHtml(
  roomName: string,
  roomId: string,
  entries: readonly ExportedMessage[],
  scope: string
): string {
  const records = entries
    .map((entry) => {
      const kind =
        entry.category === 'image'
          ? '\u56fe\u7247'
          : entry.category === 'video'
            ? '\u89c6\u9891'
            : entry.category === 'file'
              ? '\u6587\u4ef6'
              : '';
      const media = kind
        ? `<a href="${escapeHtml(historyPermalink(roomId, entry.eventId))}" target="_blank" rel="noopener noreferrer">[${kind}] \u67e5\u770b\u539f\u6d88\u606f</a>`
        : '';
      const links = entry.links
        .map(
          (link) =>
            `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a>`
        )
        .join(' ');
      return `<article class="msg"><div class="meta"><strong>${escapeHtml(entry.senderName)}</strong> <small>${escapeHtml(entry.senderId)} \u00b7 ${escapeHtml(dateTime(entry.timestamp))}</small></div><p>${escapeHtml(entry.body)}</p><div class="refs">${media} ${links}</div></article>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(roomName)} - \u804a\u5929\u8bb0\u5f55</title>
<style>body{margin:2rem auto;padding:0 1rem;max-width:60rem;font:16px/1.6 system-ui,sans-serif;background:#f7f7fa;color:#24242c}h1{font-size:1.5rem}.notice{background:#fff5df;border:1px solid #e6d5aa;padding:1rem}.msg{background:white;border:1px solid #ddd;border-radius:8px;margin:1rem 0;padding:1rem}.meta{display:flex;gap:.7rem;flex-wrap:wrap;align-items:baseline}.meta small{opacity:.7}.msg p{white-space:pre-wrap;overflow-wrap:anywhere}.refs{display:flex;gap:1rem;flex-wrap:wrap}a{color:#3156be;overflow-wrap:anywhere}</style></head>
<body><h1>${escapeHtml(roomName)} - \u804a\u5929\u8bb0\u5f55</h1>
<p class="notice">\u6587\u4ef6\u542b\u660e\u6587\u804a\u5929\u8bb0\u5f55\uff0c\u8bf7\u59a5\u5584\u4fdd\u7ba1\u3002\u5a92\u4f53\u9700\u5728 Matrix \u5ba2\u6237\u7aef\u5185\u67e5\u770b\u3002</p>
<p>Matrix: ${escapeHtml(roomId)}<br>\u8bb0\u5f55\u8303\u56f4: ${escapeHtml(scope)}<br>\u6570\u91cf: ${entries.length}<br>\u5bfc\u51fa\u65f6\u95f4: ${escapeHtml(dateTime(Date.now()))}</p>
${records}</body></html>`;
}

export function saveHistoryFile(
  roomName: string,
  format: HistoryExportFormat,
  contents: string
): void {
  const filename = `${roomName.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').slice(0, 70) || 'matrix-room'}-\u804a\u5929\u8bb0\u5f55-${new Date().toISOString().slice(0, 10)}.${format}`;
  const mime = format === 'html' ? 'text/html' : format === 'md' ? 'text/markdown' : 'text/plain';
  const blob = new Blob([format === 'html' ? '' : '\ufeff', contents], {
    type: `${mime};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
}
