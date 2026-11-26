import type { Rpc, TimelineItemView } from '#src/generated/protocol';

export const HISTORY_EXPORT_CONTEXT = Symbol('room-history-export');

export interface RoomHistoryExportContext {
  roomId: () => string;
  roomName: () => string;
  timelineItems: () => readonly TimelineItemView[];
  reachesStart: () => boolean;
  reachesLatest: () => boolean;
  members: () => readonly unknown[];
  readPage: Rpc['timeline']['historyPage'];
  jumpToMessage: (eventId: string) => void;
}
