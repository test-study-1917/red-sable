import { afterEach, expect, test, vi } from 'vitest';
import type { CallBackendView } from '#src/generated/protocol';

import { callModerationGrant, moderateCallParticipant } from './call-moderation';

function backend(
  video: Record<string, unknown> = { room: 'rtc-room', roomAdmin: true }
): CallBackendView {
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'moderator',
      exp: Math.floor(Date.now() / 1000) + 3600,
      video,
    })
  ).toString('base64url');
  return {
    id: 'sfu',
    url: 'wss://sfu.example.org',
    jwt: `header.${payload}.signature`,
    identity: 'moderator',
  };
}

afterEach(() => vi.unstubAllGlobals());

test('only exposes controls for a room-scoped admin grant, with a safe HTTP endpoint', () => {
  expect(callModerationGrant(backend())).toEqual({
    endpoint: 'https://sfu.example.org/twirp/livekit.RoomService/',
    room: 'rtc-room',
  });
  expect(callModerationGrant(backend({ room: 'rtc-room', roomJoin: true }))).toBeNull();
  expect(callModerationGrant(backend({ roomAdmin: true }))).toBeNull();
  expect(callModerationGrant({ ...backend(), identity: 'different-user' })).toBeNull();
  expect(callModerationGrant({ ...backend(), jwt: 'invalid' })).toBeNull();
  expect(callModerationGrant({ ...backend(), url: 'ws://sfu.example.org' })).toBeNull();
  expect(callModerationGrant({ ...backend(), url: 'https://sfu.example.org?token=x' })).toBeNull();
  const expired = Buffer.from(
    JSON.stringify({ sub: 'moderator', exp: 1, video: { room: 'rtc-room', roomAdmin: true } })
  ).toString('base64url');
  expect(callModerationGrant({ ...backend(), jwt: `h.${expired}.s` })).toBeNull();
});

test('mutes only current microphone publications at the server, for any target client', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        tracks: [
          { sid: 'camera', source: 'CAMERA' },
          { sid: 'screen-audio', source: 'SCREEN_SHARE_AUDIO' },
          { sid: 'microphone-new', source: 'MICROPHONE', muted: false },
          { sid: 'microphone-already-muted', source: 2, muted: true },
        ],
      })
    )
    .mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal('fetch', fetcher);
  const grant = backend();
  await moderateCallParticipant(grant, 'other-frontend', 'mute', new AbortController().signal);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [url, options] = fetcher.mock.calls[1];
  expect(url).toBe('https://sfu.example.org/twirp/livekit.RoomService/MutePublishedTrack');
  expect(JSON.parse(options.body)).toEqual({
    room: 'rtc-room',
    identity: 'other-frontend',
    track_sid: 'microphone-new',
    muted: true,
  });
  expect(options.headers.Authorization).toBe(`Bearer ${grant.jwt}`);
  expect(options.redirect).toBe('error');
});

test('removes only the selected SFU participant without Matrix room membership operations', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({}));
  vi.stubGlobal('fetch', fetcher);
  await moderateCallParticipant(backend(), 'other-device', 'remove', new AbortController().signal);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toContain('/RemoveParticipant');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    room: 'rtc-room',
    identity: 'other-device',
  });
});

test.each([401, 403, 404, 500])(
  'reports server rejection %s without falling back to local volume or signaling',
  async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status }));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      moderateCallParticipant(backend(), 'target', 'mute', new AbortController().signal)
    ).rejects.toMatchObject({
      code: status === 401 || status === 403 ? 'denied' : status === 404 ? 'gone' : 'failed',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  }
);

test('refuses self-targeting and missing privileges before any request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    moderateCallParticipant(backend(), 'moderator', 'remove', new AbortController().signal)
  ).rejects.toMatchObject({ code: 'unavailable' });
  await expect(
    moderateCallParticipant(
      backend({ room: 'rtc-room' }),
      'target',
      'remove',
      new AbortController().signal
    )
  ).rejects.toMatchObject({ code: 'unavailable' });
  expect(fetcher).not.toHaveBeenCalled();
});

test('does not treat screen audio or a missing microphone as a successful mute', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ tracks: [{ source: 'SCREEN_SHARE_AUDIO', sid: 'screen' }] })
    );
  vi.stubGlobal('fetch', fetcher);
  await expect(
    moderateCallParticipant(backend(), 'target', 'mute', new AbortController().signal)
  ).rejects.toMatchObject({ code: 'gone' });
  expect(fetcher).toHaveBeenCalledOnce();
});

test('passes cancellation through to the SFU request', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn((_url, options) => {
    options.signal.throwIfAborted();
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(
    moderateCallParticipant(backend(), 'target', 'remove', controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
});
