import { expect, test, vi } from 'vitest';

import { CALL_CONTROL_KEY, callControlMember, createCallModeration } from './call-moderation';

test('a room send is not success without the other client acknowledging the action', async () => {
  vi.useFakeTimers();
  try {
    const self = callControlMember('@a:test', 'DEVICE', '@a:test:DEVICE', 1);
    const target = callControlMember('@b:test', 'DEVICE', 'per-join-id', 1);
    const send = vi
      .fn<Parameters<typeof createCallModeration>[0]['send']>()
      .mockResolvedValue(null);
    const control = createCallModeration({
      local: () => self,
      members: () => [self, target],
      send,
      mute: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      remove: () => {},
    });
    const request = control.request(target, 'mute');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await request).toBe('unavailable');
    const { id } = send.mock.calls[0][0][CALL_CONTROL_KEY];
    expect(id).toEqual(expect.any(String));
    expect(send).toHaveBeenCalledWith({
      [CALL_CONTROL_KEY]: {
        id,
        kind: 'request',
        action: 'mute',
        from: self,
        to: target,
      },
    });
  } finally {
    vi.useRealTimers();
  }
});

test('a request without server age needs a fresh confirmation and can run only once', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] });
  try {
    const self = callControlMember('@a:test', 'DEVICE', '@a:test:DEVICE', 1);
    const peer = callControlMember('@b:test', 'DEVICE', 'per-join-id', 1);
    const send = vi
      .fn<Parameters<typeof createCallModeration>[0]['send']>()
      .mockResolvedValue(null);
    const mute = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const control = createCallModeration({
      local: () => self,
      members: () => [self, peer],
      send,
      mute,
      remove: () => {},
    });
    const request = { id: 'old', from: peer, to: self, kind: 'request', action: 'mute' };
    await control.receive(request, peer.user_id, true);
    await control.receive(request, peer.user_id, true);
    expect(send).toHaveBeenCalledOnce();
    const firstChallenge = send.mock.calls[0][0][CALL_CONTROL_KEY];
    if (firstChallenge.kind !== 'challenge') throw new Error('Expected a challenge');
    await control.receive(
      { ...request, kind: 'confirm', nonce: crypto.randomUUID() },
      peer.user_id,
      true
    );
    vi.advanceTimersByTime(10_001);
    await control.receive(
      { ...request, kind: 'confirm', nonce: firstChallenge.nonce },
      peer.user_id,
      true
    );
    expect(mute).not.toHaveBeenCalled();

    const currentRequest = { ...request, id: 'current' };
    await control.receive(currentRequest, peer.user_id, true);
    const nextChallenge = send.mock.calls[1][0][CALL_CONTROL_KEY];
    if (nextChallenge.kind !== 'challenge') throw new Error('Expected a challenge');
    const confirmation = { ...currentRequest, kind: 'confirm', nonce: nextChallenge.nonce };
    vi.setSystemTime(Date.now() + 3_600_000);
    await control.receive(confirmation, peer.user_id, true);
    await control.receive(confirmation, peer.user_id, true);
    expect(mute).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
