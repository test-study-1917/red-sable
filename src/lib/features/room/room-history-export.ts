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
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
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
  const media = record(content.media);
  const msgtype = (
    string(content.msgtype) ??
    string(record(content.message).msgtype) ??
    string(content.message_type) ??
    string(media.kind) ??
    string(content.kind) ??
    ''
  ).toLowerCase();
  if (msgtype.includes('image')) return 'image';
  if (msgtype.includes('video')) return 'video';
  if (msgtype.includes('file') || msgtype.includes('audio')) return 'file';
  return 'message';
}

/** Return null for non-message timeline entries (day dividers, state events, etc.). */
export function normalizeHistoryItem(
  value: unknown,
  names: ReadonlyMap<string, string> = new Map()
): ExportedMessage | null {
  const item = record(value);
  const eventId = string(item.event_id) ?? string(item.eventId);
  if (!eventId) return null;
  const content = record(item.content);
  const kind = string(content.kind) ?? '';
  // Export message-like content only; do not write a state/receipt event as a chat message.
  if (['state_event', 'read_receipt', 'divider', 'date', 'membership'].includes(kind)) return null;
  const embedded = record(content.message);
  const plainBody =
    string(content.body) ??
    string(embedded.body) ??
    string(content.filename) ??
    string(record(content.media).filename) ??
    string(item.body);
  const category = categoryOf(content);
  if (!plainBody && category === 'message') return null;
  const body = plainBody ?? (category === 'image' ? '[图片]' : category === 'video' ? '[视频]' : '[文件]');
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
    hasLink: /(?:https?:\/\/|matrix:|matrix\.to\/)/i.test(body),
  };
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

export function sortedHistory(items: Iterable<ExportedMessage>): ExportedMessage[] {
  return [...items].sort(
    (a, b) =>
      (a.timestamp ?? 0) - (b.timestamp ?? 0) || a.eventId.localeCompare(b.eventId)
  );
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
  const hour = match[4] === undefined ? (upper ? 23 : 0) : Number(match[4]);
  const minute = match[5] === undefined ? (upper ? 59 : 0) : Number(match[5]);
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const parsed = new Date(year, month - 1, day, hour, minute, upper ? 59 : 0, upper ? 999 : 0);
  if (
    parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day || parsed.getHours() !== hour || parsed.getMinutes() !== minute
  ) return null;
  return parsed.getTime();
}

export function filterHistory(items: readonly ExportedMessage[], filters: HistoryFilter): ExportedMessage[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const after = filters.after ? parseHistoryBoundary(filters.after, false) : null;
  const before = filters.before ? parseHistoryBoundary(filters.before, true) : null;
  return items.filter((item) => {
    if (filters.senderId && item.senderId !== filters.senderId) return false;
    if (query && !`${item.senderName} ${item.senderId} ${item.body}`.toLocaleLowerCase().includes(query)) {
      return false;
    }
    if (after !== null && (item.timestamp === null || item.timestamp < after)) return false;
    if (before !== null && (item.timestamp === null || item.timestamp > before)) return false;
    if (filters.category === 'file' && item.category !== 'file') return false;
    if (filters.category === 'media' && item.category !== 'image' && item.category !== 'video') return false;
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
      entry.category === 'image' ? '[图片] ' :
      entry.category === 'video' ? '[视频] ' :
      entry.category === 'file' ? '[文件] ' : '';
    out.push(kindLabel + entry.body, '');
  }
  return out.join('\r\n');
}

export function saveHistoryText(roomName: string, text: string): void {
  const filename = `${roomName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 70) || 'matrix-room'}-聊天记录-${new Date().toISOString().slice(0, 10)}.txt`;
  const blob = new Blob(['\ufeff', text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
