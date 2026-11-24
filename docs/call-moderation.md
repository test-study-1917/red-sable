# Voice call participant controls

In an active call, an authorized participant can open the menu on another
participant's camera/avatar tile and choose **Turn off microphone** or
**Remove from call**. Removal asks for confirmation. Controls target the selected
device, including when a user has joined from several devices.

The microphone operation uses LiveKit's `GetParticipant` and `MutePublishedTrack`
APIs, filtering for microphone tracks. The removal operation uses
`RemoveParticipant`. These operate at the media server, so the target can use a
different LiveKit client, including Element Call. No Sable-specific remote event
handler is needed. Microphone mute is a one-time action; it does not prohibit the
participant from turning their microphone back on. Removal disconnects that
participant from the call; this feature does not implement an admission ban.
Chat room membership and Matrix power levels are unchanged. The volume control
labelled **Mute for me** remains a separate local playback setting.

## Server requirements

The MatrixRTC authorization service must issue a signed LiveKit token with
`video.roomAdmin: true` and `video.room` scoped to the current SFU room, for
users authorized by the deployment's moderation policy. The token must retain
the participant identity and normal join grants. Ordinary MatrixRTC join tokens
do not necessarily include this grant; adding client controls alone does not
enable moderation on those deployments. This repository does not contain that
authorization service, and this change does not configure it or choose who
receives permission.

`roomAdmin` grants more LiveKit administration privileges than these two menu
items. The authorization service must enforce its policy before issuing it.
Do not put LiveKit API secrets in public web configuration or client code.

The LiveKit HTTPS endpoint must expose `/twirp/livekit.RoomService/` alongside
its WebSocket endpoint, and allow the web client's origin, `POST`, `Authorization`
and `Content-Type` in CORS. Existing URL path prefixes are preserved. Unencrypted
HTTP is supported only for local development on loopback addresses.

For calls using several SFUs, permission is required on the target participant's
SFU. The client chooses the backend identified by the participant, and uses the
room name from that backend's token rather than the Matrix chat room ID. It does
not try an unrelated SFU if permission is missing or an operation fails.

No control is offered without an appropriate grant. Server refusals and network
failures are displayed as errors; they do not fall back to local volume changes
or room kicks. Requests are cancelled when leaving the call.

## Interoperability validation

On a test deployment with the authorization policy configured, join the same
call from Sable and another LiveKit frontend. Verify both encrypted and
unencrypted calls:

1. Turn off the other device's microphone from Sable. Its microphone should
   become muted for every listener, while camera and screen audio are unaffected.
   The other participant can explicitly enable their microphone again.
2. Remove that device. It should disconnect from the media server, while all
   other devices remain in the call and the user's Matrix room membership remains
   joined. Check the authorization service's rejoin behavior separately.
3. Repeat with an ordinary token: no participant management menu should appear.
   Confirm that LiveKit itself rejects requests made with that token.
4. With multiple SFUs, repeat against a participant on each SFU, and with one
   backend lacking the grant. A denied action must not target a different backend.

The automated API contract tests mock the SFU responses. Actual server permission
configuration and interoperability still require a deployment and test accounts.
