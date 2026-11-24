import { expect, test, vi } from 'vitest';
import type { Rpc, RoomPowerLevelsView } from '#src/generated/protocol';
import {
  anyoneCanModerateCall,
  CALL_MODERATION_PERMISSION,
  mayModerateCall,
} from './call-moderation-policy';

test.each([undefined, 100, 50, -1])('defaults to administrators for setting %s', (value) => {
  expect(
    anyoneCanModerateCall({
      events: value === undefined ? {} : { [CALL_MODERATION_PERMISSION]: value },
    } as RoomPowerLevelsView)
  ).toBe(false);
});

test.each([
  [false, 0, 'join', false],
  [false, 50, 'join', false],
  [false, 100, 'join', true],
  [true, 0, 'join', true],
  [true, -1, 'join', true],
  [true, 100, 'leave', false],
] as const)(
  'policy open=%s level=%s membership=%s allows=%s',
  async (open, level, membership, allowed) => {
    const rpc = {
      members: {
        powerLevels: vi.fn(() =>
          Promise.resolve({
            events: { [CALL_MODERATION_PERMISSION]: open ? 0 : 100 },
          })
        ),
        member: vi.fn(() => Promise.resolve({ power_level: level, membership })),
      },
    } as unknown as Rpc;
    expect(await mayModerateCall(rpc, '!room:x', '@caller:x')).toBe(allowed);
  }
);

test('unavailable permission data fails closed', async () => {
  const rpc = {
    members: {
      powerLevels: vi.fn(() => Promise.reject(new Error('offline'))),
      member: vi.fn(() => Promise.resolve(null)),
    },
  } as unknown as Rpc;
  await expect(mayModerateCall(rpc, '!room:x', '@caller:x')).rejects.toThrow('offline');
});
