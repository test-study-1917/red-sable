import { RoomEvent, type Room, type RemoteParticipant } from 'livekit-client';
import {
  CallModerationError,
  type CallModerationAction,
  type CallModerationErrorCode,
} from './call-moderation';

export type CallModerationHandler = (
  action: CallModerationAction,
  callerIdentity: string,
  signal: AbortSignal
) => Promise<{ afterAcknowledged?: () => Promise<void> }>;

export const CALL_CONTROL_TOPIC = 'moe.sable.call.control.v1';
const TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Packet = {
  id: string;
  target: string;
  kind: 'request' | 'response';
  action?: CallModerationAction;
  result?: 'ok' | CallModerationErrorCode;
};

function packet(data: Uint8Array): Packet | null {
  if (data.byteLength > 1024) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(data));
    if (
      typeof value !== 'object' ||
      value === null ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      value.id.length > 64 ||
      !value.id ||
      !('target' in value) ||
      typeof value.target !== 'string' ||
      !value.target ||
      !('kind' in value)
    )
      return null;
    if (
      value.kind === 'request' &&
      'action' in value &&
      (value.action === 'mute' || value.action === 'remove')
    ) {
      return { id: value.id, target: value.target, kind: 'request', action: value.action };
    }
    if (
      value.kind === 'response' &&
      'result' in value &&
      (value.result === 'ok' ||
        value.result === 'denied' ||
        value.result === 'gone' ||
        value.result === 'unavailable' ||
        value.result === 'failed')
    ) {
      return { id: value.id, target: value.target, kind: 'response', result: value.result };
    }
  } catch {
    /* Ignore unrelated or malformed data. */
  }
  return null;
}

/** Each instance is bound to one LiveKit connection; SIDs prevent replay after rejoining. */
export function createPeerCallModeration(room: Room) {
  let handler: CallModerationHandler | undefined;
  let disposed = false;
  const pending = new Map<string, { sid: string; finish: (error?: Error) => void }>();
  const received = new Set<string>();
  const active = new Map<AbortController, string>();

  const send = (identity: string, value: Packet) =>
    room.localParticipant.publishData(encoder.encode(JSON.stringify(value)), {
      reliable: true,
      destinationIdentities: [identity],
      topic: CALL_CONTROL_TOPIC,
    });

  const receive = async (
    data: Uint8Array,
    sender: RemoteParticipant | undefined,
    _kind: unknown,
    topic?: string
  ) => {
    if (
      disposed ||
      topic !== CALL_CONTROL_TOPIC ||
      !sender ||
      room.remoteParticipants.get(sender.identity)?.sid !== sender.sid
    )
      return;
    const value = packet(data);
    const localSid = room.localParticipant.sid;
    if (!value || value.target !== localSid) return;
    if (value.kind === 'response') {
      const request = pending.get(value.id);
      if (request?.sid === sender.sid)
        request.finish(
          value.result === 'ok' ? undefined : new CallModerationError(value.result ?? 'failed')
        );
      return;
    }
    if (!handler || !value.action || active.size >= 8) return;
    const key = `${sender.sid}:${value.id}`;
    if (received.has(key)) return;
    received.add(key);
    const oldest = received.values().next().value;
    if (received.size > 256 && oldest !== undefined) received.delete(oldest);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);
    active.set(controller, sender.sid);
    const current = () =>
      !disposed &&
      !controller.signal.aborted &&
      localSid === room.localParticipant.sid &&
      room.remoteParticipants.get(sender.identity)?.sid === sender.sid;
    try {
      const finish = await handler(value.action, sender.identity, controller.signal);
      if (!current()) return;
      // Queue the acknowledgement before disconnecting our media transport.
      await send(sender.identity, {
        kind: 'response',
        id: value.id,
        target: sender.sid,
        result: 'ok',
      });
      if (current()) await finish.afterAcknowledged?.();
    } catch (error) {
      if (current())
        await send(sender.identity, {
          kind: 'response',
          id: value.id,
          target: sender.sid,
          result: error instanceof CallModerationError ? error.code : 'failed',
        }).catch(() => {});
    } finally {
      clearTimeout(timer);
      active.delete(controller);
    }
  };
  const onData = (...args: Parameters<typeof receive>) => {
    void receive(...args);
  };
  room.on(RoomEvent.DataReceived, onData);
  const onLeft = (participant: RemoteParticipant) => {
    for (const [controller, sid] of active) if (sid === participant.sid) controller.abort();
    for (const request of pending.values()) {
      if (request.sid === participant.sid) request.finish(new CallModerationError('gone'));
    }
  };
  room.on(RoomEvent.ParticipantDisconnected, onLeft);

  return {
    setHandler(next: CallModerationHandler | undefined) {
      handler = next;
    },
    request(identity: string, action: CallModerationAction, signal: AbortSignal): Promise<void> {
      const target = room.remoteParticipants.get(identity);
      if (disposed || !target?.sid || !room.localParticipant.sid) {
        return Promise.reject(new CallModerationError('gone'));
      }
      if (signal.aborted) return Promise.reject(new CallModerationError('failed'));
      if (pending.size) return Promise.reject(new CallModerationError('failed'));
      const id = crypto.randomUUID();
      return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          finish(new CallModerationError('failed'));
        };
        const timer = setTimeout(() => {
          finish(new CallModerationError('unavailable'));
        }, TIMEOUT_MS);
        const finish = (error?: Error) => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve();
        };
        pending.set(id, { sid: target.sid, finish });
        signal.addEventListener('abort', onAbort, { once: true });
        void send(identity, { kind: 'request', id, target: target.sid, action }).catch(() => {
          finish(new CallModerationError('failed'));
        });
      });
    },
    dispose() {
      disposed = true;
      handler = undefined;
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      for (const request of pending.values()) request.finish(new CallModerationError('gone'));
      for (const controller of active.keys()) controller.abort();
      active.clear();
      received.clear();
    },
  };
}
