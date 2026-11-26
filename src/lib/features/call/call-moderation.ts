export const CALL_CONTROL_EVENT = 'io.element.call.reaction';
export const CALL_CONTROL_KEY = 'io.element.call.moderate';

export type CallModerationAction = 'mute' | 'remove';
export type CallModerationErrorCode = 'unavailable' | 'gone' | 'failed';

export type CallControlMember = {
  user_id: string;
  member_id: string;
  joined_ts: number | null;
};

type CallControlPacket = {
  id: string;
  from: CallControlMember;
  to: CallControlMember;
} & (
  | { kind: 'request'; action: CallModerationAction }
  | { kind: 'response'; result: 'ok' | 'failed' }
  | { kind: 'challenge'; nonce: string }
  | { kind: 'confirm'; nonce: string }
);

type CallControlRequest = Extract<CallControlPacket, { kind: 'request' }>;
const TIMEOUT_MS = 10_000;
const DEDUP_WINDOW_MS = 30_000;

export function callControlMember(
  userId: string,
  deviceId: string,
  memberId: string,
  joinedTs: number
): CallControlMember {
  return {
    user_id: userId,
    member_id: memberId,
    // State memberships reuse this ID across calls. Sticky membership IDs are
    // unique per join and survive event refreshes with a new server timestamp.
    joined_ts: memberId === `${userId}:${deviceId}` ? joinedTs : null,
  };
}

function sameMember(a: CallControlMember, b: CallControlMember): boolean {
  return a.user_id === b.user_id && a.member_id === b.member_id && a.joined_ts === b.joined_ts;
}

function isMember(value: unknown): value is CallControlMember {
  return (
    typeof value === 'object' &&
    value !== null &&
    'user_id' in value &&
    typeof value.user_id === 'string' &&
    value.user_id.length > 0 &&
    'member_id' in value &&
    typeof value.member_id === 'string' &&
    value.member_id.length > 0 &&
    'joined_ts' in value &&
    (value.joined_ts === null ||
      (typeof value.joined_ts === 'number' &&
        Number.isSafeInteger(value.joined_ts) &&
        value.joined_ts > 0))
  );
}

function parsePacket(value: unknown): CallControlPacket | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > 64 ||
    !('from' in value) ||
    !isMember(value.from) ||
    !('to' in value) ||
    !isMember(value.to) ||
    !('kind' in value)
  )
    return undefined;
  const packet = { id: value.id, from: value.from, to: value.to };
  if (
    value.kind === 'request' &&
    'action' in value &&
    (value.action === 'mute' || value.action === 'remove')
  ) {
    return { ...packet, kind: 'request', action: value.action };
  }
  if (
    value.kind === 'response' &&
    'result' in value &&
    (value.result === 'ok' || value.result === 'failed')
  ) {
    return { ...packet, kind: 'response', result: value.result };
  }
  if (
    (value.kind === 'challenge' || value.kind === 'confirm') &&
    'nonce' in value &&
    typeof value.nonce === 'string' &&
    value.nonce.length === 36
  ) {
    return { ...packet, kind: value.kind, nonce: value.nonce };
  }
  return undefined;
}

type CallControlOptions = {
  local: () => CallControlMember | undefined;
  members: () => readonly CallControlMember[];
  send: (content: { [CALL_CONTROL_KEY]: CallControlPacket }) => Promise<unknown>;
  mute: () => Promise<boolean>;
  remove: () => void;
};

export function createCallModeration({ local, members, send, mute, remove }: CallControlOptions) {
  let pending:
    | {
        packet: CallControlRequest;
        expiresAt: number;
        finish: (error: CallModerationErrorCode | null) => void;
      }
    | undefined;
  let disposed = false;
  const activeLocal = () => (disposed ? undefined : local());
  const received = new Map<
    string,
    { receivedAt: number; verification?: { request: CallControlRequest; nonce: string } }
  >();

  return {
    async request(
      target: CallControlMember,
      action: CallModerationAction
    ): Promise<CallModerationErrorCode | null> {
      const from = local();
      if (disposed || pending) return 'unavailable';
      if (
        !from ||
        sameMember(from, target) ||
        !members().some((member) => sameMember(member, target))
      )
        return 'gone';
      const packet = {
        id: crypto.randomUUID(),
        from,
        to: target,
        kind: 'request',
        action,
      } as const;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          finish('unavailable');
        }, TIMEOUT_MS);
        const finish = (error: CallModerationErrorCode | null) => {
          if (pending?.packet !== packet) return;
          pending = undefined;
          clearTimeout(timer);
          resolve(error);
        };
        pending = { packet, expiresAt: performance.now() + TIMEOUT_MS, finish };
        void send({ [CALL_CONTROL_KEY]: packet }).catch(() => {
          finish('failed');
        });
      });
    },

    async receive(content: unknown, sender: string, requiresConfirmation: boolean): Promise<void> {
      const own = activeLocal();
      const packet = parsePacket(content);
      if (
        !own ||
        !packet ||
        sender !== packet.from.user_id ||
        !sameMember(packet.to, own) ||
        sameMember(packet.from, own)
      )
        return;

      const now = performance.now();
      if (packet.kind === 'response' || packet.kind === 'challenge') {
        if (
          pending?.packet.id !== packet.id ||
          now > pending.expiresAt ||
          !sameMember(pending.packet.from, own) ||
          !sameMember(pending.packet.to, packet.from)
        )
          return;
        if (packet.kind === 'response') {
          pending.finish(packet.result === 'ok' ? null : 'failed');
          return;
        }
        if (!members().some((member) => sameMember(member, packet.from))) return;
        void send({
          [CALL_CONTROL_KEY]: {
            id: packet.id,
            from: own,
            to: packet.from,
            kind: 'confirm',
            nonce: packet.nonce,
          },
        }).catch(() => {});
        return;
      }

      if (!members().some((member) => sameMember(member, packet.from))) return;
      for (const [key, entry] of received) {
        if (now - entry.receivedAt > DEDUP_WINDOW_MS) received.delete(key);
      }
      const key = JSON.stringify([
        packet.from.user_id,
        packet.from.member_id,
        packet.from.joined_ts,
        packet.id,
      ]);
      const previous = received.get(key);
      if (packet.kind === 'confirm') {
        if (
          !previous?.verification ||
          previous.verification.nonce !== packet.nonce ||
          now - previous.receivedAt > TIMEOUT_MS ||
          !sameMember(previous.verification.request.to, own)
        )
          return;
        return applyRequest(previous.verification.request, own, key, now);
      }
      if (previous || received.size >= 256) return;
      if (requiresConfirmation) {
        const nonce = crypto.randomUUID();
        received.set(key, { receivedAt: now, verification: { request: packet, nonce } });
        void send({
          [CALL_CONTROL_KEY]: {
            id: packet.id,
            from: own,
            to: packet.from,
            kind: 'challenge',
            nonce,
          },
        }).catch(() => {});
        return;
      }
      return applyRequest(packet, own, key, now);
    },

    dispose(): void {
      disposed = true;
      pending?.finish('gone');
      received.clear();
    },
  };

  async function applyRequest(
    packet: CallControlRequest,
    own: CallControlMember,
    key: string,
    receivedAt: number
  ): Promise<void> {
    received.set(key, { receivedAt });
    const ok = packet.action === 'remove' || (await mute());
    const current = activeLocal();
    if (!current || !sameMember(current, own)) return;
    const response = send({
      [CALL_CONTROL_KEY]: {
        id: packet.id,
        from: own,
        to: packet.from,
        kind: 'response',
        result: ok ? 'ok' : 'failed',
      },
    }).catch(() => {});
    if (packet.action !== 'remove') return;
    // An embedded client can be destroyed as soon as it hangs up. Let the
    // response reach its host first, but never block removal on the network.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      void response.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    const remaining = activeLocal();
    if (remaining && sameMember(remaining, own)) remove();
  }
}
