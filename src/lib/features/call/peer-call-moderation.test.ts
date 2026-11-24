import { afterEach, expect, test, vi } from 'vitest';
import { RoomEvent, type Room, type RemoteParticipant } from 'livekit-client';
import { CALL_CONTROL_TOPIC, createPeerCallModeration } from './peer-call-moderation';
import { CallModerationError } from './call-moderation';

function pair() {
  const rooms: ReturnType<typeof endpoint>[] = [];
  function endpoint(identity: string) {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const local = {
      identity,
      sid: `${identity}-sid`,
      publishData: vi.fn(
        (data: Uint8Array, options: { topic: string; destinationIdentities: string[] }) => {
          for (const remote of rooms)
            if (options.destinationIdentities.includes(remote.local.identity)) {
              remote.listeners.get(RoomEvent.DataReceived)?.(data, local, 0, options.topic);
            }
          return Promise.resolve();
        }
      ),
    };
    const room = {
      localParticipant: local,
      remoteParticipants: new Map(),
      on: (event: string, callback: (...args: unknown[]) => void) => {
        listeners.set(event, callback);
        return room;
      },
      off: (event: string) => {
        listeners.delete(event);
        return room;
      },
    } as unknown as Room;
    return { local, room, listeners, control: createPeerCallModeration(room) };
  }
  const alice = endpoint('alice');
  const bob = endpoint('bob');
  rooms.push(alice, bob);
  alice.room.remoteParticipants.set('bob', bob.local as unknown as RemoteParticipant);
  bob.room.remoteParticipants.set('alice', alice.local as unknown as RemoteParticipant);
  return { alice, bob };
}

afterEach(() => vi.useRealTimers());

test('two Sable endpoints acknowledge mute only after the target executes it', async () => {
  const { alice, bob } = pair();
  let muted = false;
  bob.control.setHandler((action, caller) => {
    expect(action).toBe('mute');
    expect(caller).toBe('alice');
    muted = true;
    return Promise.resolve({});
  });
  await alice.control.request('bob', 'mute', new AbortController().signal);
  expect(muted).toBe(true);
  alice.control.dispose();
  bob.control.dispose();
});

test('acknowledges removal before the target tears down its connection', async () => {
  const { alice, bob } = pair();
  const leave = vi.fn(() => {
    expect(bob.local.publishData).toHaveBeenCalledOnce();
    bob.control.dispose();
    return Promise.resolve();
  });
  bob.control.setHandler(() => Promise.resolve({ afterAcknowledged: leave }));
  await alice.control.request('bob', 'remove', new AbortController().signal);
  await vi.waitFor(() => {
    expect(leave).toHaveBeenCalledOnce();
  });
  alice.control.dispose();
});

test('receiver rejection is returned to the caller without performing the action', async () => {
  const { alice, bob } = pair();
  bob.control.setHandler(() => Promise.reject(new CallModerationError('denied')));
  await expect(
    alice.control.request('bob', 'remove', new AbortController().signal)
  ).rejects.toMatchObject({ code: 'denied' });
  alice.control.dispose();
  bob.control.dispose();
});

test('ignores stale sessions, missing senders, unknown actions and replayed requests', async () => {
  const { alice, bob } = pair();
  const handler = vi.fn(() => Promise.resolve({}));
  bob.control.setHandler(handler);
  const receive = (value: unknown, sender: unknown = alice.local) =>
    bob.listeners.get(RoomEvent.DataReceived)?.(
      new TextEncoder().encode(JSON.stringify(value)),
      sender,
      0,
      CALL_CONTROL_TOPIC
    );
  receive({ kind: 'request', id: 'one', target: 'old-sid', action: 'remove' });
  receive({ kind: 'request', id: 'one', target: bob.local.sid, action: 'ban' });
  receive({ kind: 'request', id: 'one', target: bob.local.sid, action: 'remove' }, null);
  expect(handler).not.toHaveBeenCalled();
  const value = { kind: 'request', id: 'one', target: bob.local.sid, action: 'mute' };
  receive(value);
  receive(value);
  await vi.waitFor(() => {
    expect(handler).toHaveBeenCalledOnce();
  });
  alice.control.dispose();
  bob.control.dispose();
});

test('unsupported frontends time out instead of reporting success', async () => {
  vi.useFakeTimers();
  const { alice, bob } = pair();
  const request = alice.control.request('bob', 'mute', new AbortController().signal);
  const rejected = expect(request).rejects.toMatchObject({ code: 'unavailable' });
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  alice.control.dispose();
  bob.control.dispose();
});

test('leaving cancels a request and removes its listeners', async () => {
  const { alice, bob } = pair();
  const request = alice.control.request('bob', 'remove', new AbortController().signal);
  const rejected = expect(request).rejects.toMatchObject({ code: 'gone' });
  alice.control.dispose();
  await rejected;
  expect(alice.listeners.size).toBe(0);
  bob.control.dispose();
});

test('a sender leaving aborts an authorization check already in progress', async () => {
  const { alice, bob } = pair();
  let signal: AbortSignal | undefined;
  let release!: () => void;
  bob.control.setHandler(async (_action, _caller, receivedSignal) => {
    signal = receivedSignal;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {};
  });
  const request = alice.control.request('bob', 'mute', new AbortController().signal);
  const rejected = expect(request).rejects.toMatchObject({ code: 'gone' });
  bob.listeners.get(RoomEvent.ParticipantDisconnected)?.(alice.local);
  expect(signal?.aborted).toBe(true);
  release();
  alice.control.dispose();
  bob.control.dispose();
  await rejected;
});
