import { base64ToString } from 'uint8array-extras';

import type { CallBackendView } from '#src/generated/protocol';

export type CallModerationAction = 'mute' | 'remove';
export type CallModerationErrorCode = 'unavailable' | 'denied' | 'gone' | 'failed';

export class CallModerationError extends Error {
  constructor(readonly code: CallModerationErrorCode) {
    super(`call-moderation-${code}`);
    this.name = 'CallModerationError';
  }
}

type Grant = { endpoint: string; room: string };

/** A UI capability check only. LiveKit verifies the signature and authority on every request. */
export function callModerationGrant(backend: CallBackendView): Grant | null {
  try {
    const payload = backend.jwt.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(base64ToString(payload)) as {
      sub?: unknown;
      exp?: unknown;
      video?: { room?: unknown; roomAdmin?: unknown };
    };
    if (
      claims.sub !== backend.identity ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= Date.now() ||
      claims.video?.roomAdmin !== true ||
      typeof claims.video.room !== 'string' ||
      !claims.video.room
    )
      return null;

    const url = new URL(backend.url);
    if (url.protocol === 'wss:') url.protocol = 'https:';
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      return null;
    url.pathname = `${url.pathname.replace(/\/$/, '')}/twirp/livekit.RoomService/`;
    return { endpoint: url.href, room: claims.video.room };
  } catch {
    return null;
  }
}

/** Operates on the SFU, so the target does not need to implement a Sable event. */
export async function moderateCallParticipant(
  backend: CallBackendView,
  identity: string,
  action: CallModerationAction,
  signal: AbortSignal
): Promise<void> {
  const grant = callModerationGrant(backend);
  if (!grant || !identity || identity === backend.identity) {
    throw new CallModerationError('unavailable');
  }
  const request = async (method: string, body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(`${grant.endpoint}${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${backend.jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: grant.room, identity, ...body }),
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      throw new CallModerationError(
        response.status === 401 || response.status === 403
          ? 'denied'
          : response.status === 404
            ? 'gone'
            : 'failed'
      );
    }
    return response.json();
  };

  if (action === 'remove') {
    await request('RemoveParticipant', {});
    return;
  }

  // Resolve current microphone SIDs at the server. Never mute camera or screen audio,
  // and do not reuse a stale tile's track ID after a participant republishes.
  const info = await request('GetParticipant', {});
  if (
    typeof info !== 'object' ||
    info === null ||
    !('tracks' in info) ||
    !Array.isArray(info.tracks)
  ) {
    throw new CallModerationError('gone');
  }
  const microphones = info.tracks.filter(
    (track: unknown): track is { sid: string; muted?: boolean } =>
      typeof track === 'object' &&
      track !== null &&
      'source' in track &&
      'sid' in track &&
      (track.source === 'MICROPHONE' || track.source === 2) &&
      typeof track.sid === 'string' &&
      track.sid.length > 0 &&
      (!('muted' in track) || typeof track.muted === 'boolean')
  );
  if (!microphones.length) throw new CallModerationError('gone');
  for (const track of microphones) {
    if (!track.muted) await request('MutePublishedTrack', { track_sid: track.sid, muted: true });
  }
}
