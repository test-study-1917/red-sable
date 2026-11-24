import type { Rpc, RoomPowerLevelsView } from '#src/generated/protocol';

// A room-wide permission stored in m.room.power_levels, whose edits are enforced
// by the homeserver. Never use a local preference or an arbitrary state event.
export const CALL_MODERATION_PERMISSION = 'moe.sable.call.moderation';
export const CALL_ADMIN_LEVEL = 100;

export function anyoneCanModerateCall(levels: RoomPowerLevelsView | null): boolean {
  return (
    levels !== null &&
    Object.hasOwn(levels.events, CALL_MODERATION_PERMISSION) &&
    levels.events[CALL_MODERATION_PERMISSION] === 0
  );
}

export async function mayModerateCall(rpc: Rpc, roomId: string, userId: string): Promise<boolean> {
  const [levels, member] = await Promise.all([
    rpc.members.powerLevels({ room_id: roomId }),
    rpc.members.member({ room_id: roomId, user_id: userId }),
  ]);
  return (
    member?.membership === 'join' &&
    (anyoneCanModerateCall(levels) || member.power_level >= CALL_ADMIN_LEVEL)
  );
}
