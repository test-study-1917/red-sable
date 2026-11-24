<script lang="ts">
  import { i18n } from '#lib/i18n.js';
  import { useCoreClient } from '#lib/core/context.js';
  import type { RoomPowerLevelsView } from '#src/generated/protocol';
  import {
    anyoneCanModerateCall,
    CALL_ADMIN_LEVEL,
    CALL_MODERATION_PERMISSION,
  } from '#lib/features/call/call-moderation-policy.js';
  import SettingsSection from '#lib/ui/primitives/SettingsSection.svelte';
  import SettingsRow from '#lib/ui/primitives/SettingsRow.svelte';
  import Switch from '#lib/ui/primitives/Switch.svelte';
  import Alert from '#lib/ui/primitives/Alert.svelte';

  let {
    roomId,
    levels,
    ownLevel,
    canEdit,
    busy = false,
    onUpdate,
  }: {
    roomId: string;
    levels: RoomPowerLevelsView;
    ownLevel: number;
    canEdit: boolean;
    busy?: boolean;
    onUpdate: (levels: RoomPowerLevelsView) => void;
  } = $props();
  const core = useCoreClient();
  let saving = $state(false);
  let failed = $state(false);
  let switchRevision = $state(0);

  async function save(enabled: boolean): Promise<void> {
    if (!canEdit || ownLevel < CALL_ADMIN_LEVEL || saving || busy) return;
    const target = roomId;
    saving = true;
    failed = false;
    try {
      const next = await core.rpc.members.setPowerLevel({
        room_id: target,
        location: { kind: 'event', event_type: CALL_MODERATION_PERMISSION },
        level: enabled ? 0 : CALL_ADMIN_LEVEL,
      });
      if (roomId === target) onUpdate(next);
    } catch {
      if (roomId === target) failed = true;
    } finally {
      saving = false;
      switchRevision += 1;
    }
  }
</script>

<SettingsSection headingId="room-call-control" title={i18n.t('room.callControlTitle')}>
  {#if failed}<Alert variant="critical" role="alert">{i18n.t('room.permFailed')}</Alert>{/if}
  <ul class="settings-rows">
    <SettingsRow
      title={i18n.t('room.callControlEveryone')}
      description={i18n.t('room.callControlEveryoneHint')}
    >
      {#key switchRevision}
        <Switch
          label={i18n.t('room.callControlEveryone')}
          checked={anyoneCanModerateCall(levels)}
          disabled={!canEdit || ownLevel < CALL_ADMIN_LEVEL || saving || busy}
          onCheckedChange={(enabled) => void save(enabled)}
        />
      {/key}
    </SettingsRow>
  </ul>
</SettingsSection>
