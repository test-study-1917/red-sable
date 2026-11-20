/** Data bridge used by the existing RoomSearchPanel to offer local TXT export. */
export const HISTORY_EXPORT_CONTEXT = Symbol('room-history-export');

export interface RoomHistoryExportContext {
  roomId: () => string;
  roomName: () => string;
  timelineItems: () => readonly unknown[];
  members: () => readonly unknown[];
  /** Resolve true when pagination reaches the start of the timeline. */
  loadOlder: (count: number) => Promise<boolean>;
  openMedia: (eventId: string) => void;
  jumpToMessage: (eventId: string) => void;
}
