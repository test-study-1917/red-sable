# Voice call participant controls

Open **Room settings → Permissions → Voice call controls** to configure
**Allow all call participants to mute and remove others**. The switch defaults
to off. Room administrators (power level 100 or higher, including founders)
who can edit room power levels can change it.

- Off: only room administrators currently in the call can operate the controls.
- On: every joined room member currently in the call can operate them.

On another participant's avatar/camera tile, **Turn off microphone** closes
that device's microphone for the call. **Remove from call** asks for confirmation,
then makes the target device leave the current call. The target can unmute or
join again. Chat room membership, camera and screen-share audio are not changed
by microphone mute. **Mute for me** remains a separate playback control.

## Shared setting and authorization

The setting uses `m.room.power_levels.events["moe.sable.call.moderation"]`:
`0` enables everyone; `100`, a missing entry, or an unrecognized value means
administrators only. The homeserver enforces changes to the power-level event.
The switch changes this one entry using the core's existing power-level API.
It is a room setting, not a per-device preference.

The sender checks room membership and the current policy before sending. The
receiving Sable client independently checks the authenticated media participant
against its Matrix RTC roster, reads the room policy and the caller's current
room membership/power level, and rejects unauthorized requests. Permission load
failures deny the action. UI eligibility refreshes every five seconds while the
call is active; requests always recheck permissions.

## Same-client transport

Sable web calls use reliable, targeted LiveKit data packets on
`moe.sable.call.control.v1`. The selected device and its publishing SFU are used.
Connection SIDs bind packets to the current connection; malformed packets,
unknown senders, duplicate requests and requests for an old connection are ignored.
Leaving or disconnecting cancels pending work. The target acknowledges microphone
mute after applying it, or acknowledges accepted removal before disconnecting.

Both participants must use this feature in Sable. Older Sable versions and other
frontends that do not implement the protocol return no acknowledgement and the
caller sees an unavailable message after ten seconds. An acknowledgement timeout
does not prove an action was never applied. No LiveKit `roomAdmin` grant or new
server component is needed for this path. LiveKit data publishing must be allowed.

This is cooperative client behavior, not a server-enforced ban: modified clients
can ignore control requests. Receivers do not trust caller-supplied user IDs or
power levels. Only verified current participants may initiate controls.

## Retained server integration

The earlier LiveKit `GetParticipant`, `MutePublishedTrack` and `RemoveParticipant`
integration remains for transports without the Sable data-channel capability,
such as the native mobile plugin. That fallback still needs a valid, room-scoped
LiveKit `roomAdmin` grant and a reachable HTTPS RoomService endpoint with CORS.
The sender's room policy is checked before using it. The native plugin does not
yet receive Sable peer-control packets; the no-server-configuration path is for
web media transports. API secrets must never be put in client configuration.

## Validation

Tests cover administrator-only and everyone policies, rejected/non-member
callers, settings saves, receiver-side permission changes, mute/removal, packet
replay and old connections, unsupported peers, cancellation and multiple SFUs.
Transport tests connect two in-memory endpoints; they are not live-account tests.
Real deployment verification should use two updated Sable web clients, exercise
both switch states in encrypted and unencrypted calls, and confirm that users
can unmute/rejoin and remain members of their chat room.
