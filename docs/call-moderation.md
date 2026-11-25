# Voice call participant controls

In an active call, open the menu on another participant's avatar or camera tile.
Choose **Turn off microphone**, or choose **Remove from call** and confirm. Any
current call participant may request either action, subject to the Matrix room's
existing permissions for sending call events.

The other device needs an updated Sable or the matching custom Element Call
frontend. The request affects only the selected device's current call. That
device can turn its microphone back on or join again. Removal does not change
Matrix chat membership. **Mute for me** affects only your own playback.

If the other client does not acknowledge the request within 10 seconds, you see
that it did not respond. Receiving an acknowledgement does not require changing
the LiveKit deployment or signing admin tokens for participants.

## Protocol

Like **End for everyone**, both actions use live Matrix
`io.element.call.reaction` events. The existing `io.element.call.terminate`
payload is unchanged. A directed control uses the `io.element.call.moderate`
payload:

- Requests include a unique `id`, `kind: "request"`, and
  `action: "mute" | "remove"`.
- Replies copy the request ID, swap `from` and `to`, and carry
  `kind: "response"` and `result: "ok" | "failed"`.
- When Matrix omits the event's age, the recipient first sends
  `kind: "challenge"` with the request ID and a random `nonce`. The requester
  echoes that nonce in `kind: "confirm"` only while the original request is
  still pending. Each message identifies the sending and receiving memberships.
- All four message kinds carry `from` and `to` with `user_id`, `member_id` and `joined_ts`.
  Sticky memberships have a fresh member ID each time and set `joined_ts: null`.
  Compatibility and legacy memberships reuse an ID and carry that membership's
  creation timestamp in `joined_ts`.

The recipient compares the packet sender to the Matrix event sender and checks
both membership addresses against the current call. Old, invalid, wrong-device
and duplicate requests do not run. If the server supplies an age, the recipient
allows up to 30 seconds including time waiting for decryption, without comparing
device and server clocks. Without an age, a matching confirmation must arrive
within 10 seconds of the challenge. An older sender that does not support this
exchange will time out rather than have an unverified request applied. A matched reply may arrive after the target
has already left RTC. Encrypted rooms use the Matrix SDK's existing room-event
encryption and live-event decryption path.

The previous room permission toggle, private LiveKit data packets, and LiveKit
RoomService fallback are no longer used. Existing room power-level data is not
changed. A client that ignores the request cannot be forced off the call by
this protocol.
