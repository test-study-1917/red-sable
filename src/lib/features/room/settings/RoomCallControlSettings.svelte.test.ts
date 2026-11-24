// @vitest-environment happy-dom
import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { RoomPowerLevelsView } from '#src/generated/protocol';
vi.mock('#lib/core/context.js');
import { core } from '#lib/core/__mocks__/context.js';
import RoomCallControlSettings from './RoomCallControlSettings.svelte';

const permission = 'moe.sable.call.moderation';
const base = { events: {} } as RoomPowerLevelsView;
const label = 'Allow all call participants to mute and remove others';

test.each([false, true])('administrator can change the shared setting from %s', async (enabled) => {
  const next = { ...base, events: { [permission]: enabled ? 100 : 0 } };
  core.rpc.members.setPowerLevel.mockResolvedValue(next);
  const onUpdate = vi.fn();
  render(RoomCallControlSettings, {
    roomId: '!room:x',
    levels: { ...base, events: enabled ? { [permission]: 0 } : {} },
    ownLevel: 100,
    canEdit: true,
    onUpdate,
  });
  const toggle = screen.getByRole('switch', { name: label });
  expect(toggle).toHaveAttribute('aria-checked', String(enabled));
  await userEvent.setup().click(toggle);
  await vi.waitFor(() => {
    expect(onUpdate).toHaveBeenCalledWith(next);
  });
  expect(core.rpc.members.setPowerLevel).toHaveBeenCalledWith({
    room_id: '!room:x',
    location: { kind: 'event', event_type: permission },
    level: enabled ? 100 : 0,
  });
});

test.each([
  [50, true],
  [0, false],
  [100, false],
] as const)('level %s editable=%s cannot change the switch', (ownLevel, canEdit) => {
  render(RoomCallControlSettings, {
    roomId: '!room:x',
    levels: base,
    ownLevel,
    canEdit,
    onUpdate: vi.fn(),
  });
  expect(screen.getByRole('switch', { name: label })).toBeDisabled();
});

test('a denied save does not report a changed permission', async () => {
  core.rpc.members.setPowerLevel.mockRejectedValueOnce(new Error('denied'));
  const onUpdate = vi.fn();
  render(RoomCallControlSettings, {
    roomId: '!room:x',
    levels: base,
    ownLevel: 100,
    canEdit: true,
    onUpdate,
  });
  await userEvent.setup().click(screen.getByRole('switch', { name: label }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(onUpdate).not.toHaveBeenCalled();
  expect(screen.getByRole('switch', { name: label })).not.toBeChecked();
});
