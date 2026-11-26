use std::collections::HashSet;
use std::time::Duration;

use super::membership::{StickyDeadlines, StickyExpiry, StickyTrust};
use crate::delayed_events::DelayedEventsSupport;
use matrix_sdk::deserialized_responses::{EncryptionInfo, VerificationLevel, VerificationState};
use matrix_sdk::{Client, Room};
use ruma::api::client::sync::sync_events::msc4186 as v5;
use ruma::events::{StateEventType, room::encrypted::OriginalSyncRoomEncryptedEvent};
use ruma::serde::Raw;
use ruma::{OwnedDeviceId, OwnedEventId};
use serde_json::Value;

pub(super) const STICKY_DURATION_MS: u32 = 3_600_000;

pub(super) struct StickySync {
    conn_id: String,
    include_invite_state: bool,
    pos: Option<String>,
    pending: Vec<(String, Value)>,
    encrypted_deadlines: StickyDeadlines,
}

pub(crate) struct Event {
    value: Value,
    device: Option<OwnedDeviceId>,
    redacts: Option<OwnedEventId>,
    expiry: StickyExpiry,
    observed_at: u64,
}

fn redaction_target(room: &Room, value: &Value) -> Option<OwnedEventId> {
    if value.get("type")?.as_str()? != "m.room.redaction" {
        return None;
    }
    let event: ruma::events::room::redaction::SyncRoomRedactionEvent =
        serde_json::from_value(value.clone()).ok()?;
    event
        .redacts(&room.clone_info().room_version_rules_or_default().redaction)
        .map(ToOwned::to_owned)
}

fn authenticated_device(info: Option<&EncryptionInfo>, value: &Value) -> Option<OwnedDeviceId> {
    let info = info?;
    if value.get("sender")?.as_str()? != info.sender.as_str() {
        return None;
    }
    trusted_sender_device(info)
}

/// The sender device, unless the SDK found a verification violation, a mismatched sender or no
/// device to link the event to. A device its owner never signed is still accepted.
pub(super) fn trusted_sender_device(info: &EncryptionInfo) -> Option<OwnedDeviceId> {
    match &info.verification_state {
        VerificationState::Verified
        | VerificationState::Unverified(
            VerificationLevel::UnverifiedIdentity | VerificationLevel::UnsignedDevice,
        ) => info.sender_device.clone(),
        VerificationState::Unverified(_) => None,
    }
}

impl Event {
    pub(crate) fn into_value(self) -> Value {
        self.value
    }
    pub(crate) fn apply(
        &self,
        memberships: &mut super::membership::StickyMemberships,
        encrypted: bool,
        now: u64,
    ) -> bool {
        if let Some(event_id) = &self.redacts {
            memberships.redact(event_id.as_str(), now);
            return true;
        }
        let trust = if encrypted {
            self.device
                .as_deref()
                .map_or(StickyTrust::Untrusted, StickyTrust::Authenticated)
        } else {
            StickyTrust::Plain
        };
        memberships.apply_with_trust(
            &self.value,
            now,
            trust,
            Some((self.expiry, self.observed_at)),
        )
    }
}

impl StickySync {
    pub(super) fn new(session: u32) -> Self {
        Self {
            conn_id: format!("call-{session}"),
            include_invite_state: false,
            pos: None,
            pending: Vec::new(),
            encrypted_deadlines: StickyDeadlines::default(),
        }
    }

    pub(super) fn for_invites() -> Self {
        Self {
            conn_id: format!("call-invites-{}", ruma::TransactionId::new()),
            include_invite_state: true,
            pos: None,
            pending: Vec::new(),
            encrypted_deadlines: StickyDeadlines::default(),
        }
    }

    fn request(&self, room: &Room, timeout: Duration) -> v5::Request {
        let mut request = v5::Request::new();
        request.pos.clone_from(&self.pos);
        request.conn_id = Some(self.conn_id.clone());
        request.timeout = Some(timeout);
        let mut subscription = v5::request::RoomSubscription::default();
        subscription
            .required_state
            .push((StateEventType::RoomCreate, String::new()));
        if self.include_invite_state {
            for event_type in super::SLOT_TYPES {
                subscription
                    .required_state
                    .push((event_type.into(), "*".to_owned()));
            }
            subscription
                .required_state
                .push(("org.matrix.msc3401.call.member".into(), "*".to_owned()));
            subscription
                .required_state
                .push((StateEventType::RoomPowerLevels, String::new()));
        }
        request
            .room_subscriptions
            .insert(room.room_id().to_owned(), subscription);
        request.extensions.to_device.enabled = false;
        request.extensions.sticky_events.enabled = Some(true);
        request
    }

    pub(super) async fn sync(
        &mut self,
        room: &Room,
        timeout: Duration,
    ) -> Result<Vec<Event>, matrix_sdk::HttpError> {
        let response = self.poll(room, timeout).await;
        self.resolve_response(room, response, crate::now_ms()).await
    }

    pub(super) async fn poll(
        &self,
        room: &Room,
        timeout: Duration,
    ) -> Result<v5::Response, matrix_sdk::HttpError> {
        room.client().send(self.request(room, timeout)).await
    }

    pub(super) async fn resolve_response(
        &mut self,
        room: &Room,
        response: Result<v5::Response, matrix_sdk::HttpError>,
        now: u64,
    ) -> Result<Vec<Event>, matrix_sdk::HttpError> {
        self.resolve_for_call(room, response, now, None).await
    }

    pub(super) async fn resolve_for_call(
        &mut self,
        room: &Room,
        response: Result<v5::Response, matrix_sdk::HttpError>,
        now: u64,
        state: Option<&tokio::sync::Mutex<super::runtime::State>>,
    ) -> Result<Vec<Event>, matrix_sdk::HttpError> {
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                self.pos = None;
                return Err(error);
            }
        };
        let sticky = response.extensions.sticky_events;
        let mut events: Vec<Value> = Vec::new();
        if let Some(room_events) = sticky.rooms.get(room.room_id()) {
            events.extend(
                room_events
                    .events
                    .iter()
                    .filter_map(|event| serde_json::from_str(event.json().get()).ok()),
            );
        }
        if let Some(room_events) = response.rooms.get(room.room_id()) {
            if self.include_invite_state {
                events.extend(
                    room_events
                        .required_state
                        .iter()
                        .filter_map(|event| serde_json::from_str(event.json().get()).ok()),
                );
            }
            events.extend(
                room_events
                    .timeline
                    .iter()
                    .filter_map(|event| serde_json::from_str(event.json().get()).ok()),
            );
        }
        self.encrypted_deadlines.prune(now);
        let mut candidates: Vec<_> = std::mem::take(&mut self.pending)
            .into_iter()
            .map(|(id, value)| (Some(id), value))
            .collect();
        let mut shared = match state {
            Some(state) => Some(state.lock().await),
            None => None,
        };
        for value in events {
            if value.get("type").and_then(Value::as_str) != Some("m.room.encrypted") {
                candidates.push((None, value));
                continue;
            }
            let Some(event_id) = value.get("event_id").and_then(Value::as_str) else {
                continue;
            };
            if sticky_duration(&value).is_none() {
                continue;
            }
            let expiry = sticky_expiry(&value, now);
            self.encrypted_deadlines.record(event_id, expiry, now);
            if let (Some(shared), StickyExpiry::Known(at)) = (&mut shared, expiry) {
                shared.sticky.record_lease(event_id, at, now);
            }
            candidates.push((Some(event_id.to_owned()), value));
        }
        drop(shared);
        let mut resolved = Vec::new();
        let mut tried = HashSet::new();
        for (event_id, value) in candidates {
            let Some(event_id) = event_id else {
                resolved.push(Event {
                    redacts: redaction_target(room, &value),
                    expiry: sticky_expiry(&value, now),
                    observed_at: now,
                    value,
                    device: None,
                });
                continue;
            };
            let Some(expires) = self
                .encrypted_deadlines
                .expiry(&event_id)
                .filter(|expires| expires.at() > now)
            else {
                continue;
            };
            if tried.insert(event_id.clone())
                && let Some(event) = self
                    .decrypt_candidate(room, (event_id, value), expires, now)
                    .await
            {
                resolved.push(event);
            }
        }
        self.pos = Some(response.pos);
        Ok(resolved)
    }

    async fn decrypt_candidate(
        &mut self,
        room: &Room,
        candidate: (String, Value),
        expires: StickyExpiry,
        now: u64,
    ) -> Option<Event> {
        let raw = Raw::new(&candidate.1)
            .map(Raw::cast_unchecked::<OriginalSyncRoomEncryptedEvent>)
            .ok()?;
        let Ok(decrypted) = room.decrypt_event(&raw, None).await else {
            self.defer(candidate);
            return None;
        };
        let Some(info) = decrypted.encryption_info() else {
            self.defer(candidate);
            return None;
        };
        let value = candidate.1;
        let mut plaintext = serde_json::from_str::<Value>(decrypted.raw().json().get()).ok()?;
        if let Some(object) = plaintext.as_object_mut() {
            for field in ["msc4354_sticky", "sticky"] {
                if let Some(envelope) = value.get(field) {
                    object.insert(field.to_owned(), envelope.clone());
                }
            }
            let unsigned = object
                .entry("unsigned")
                .or_insert_with(|| serde_json::json!({}));
            if let Some(unsigned) = unsigned.as_object_mut() {
                unsigned.insert(
                    "msc4354_sticky_duration_ttl_ms".to_owned(),
                    expires.at().saturating_sub(now).into(),
                );
            }
        }
        let device = authenticated_device(Some(info), &plaintext);
        Some(Event {
            value: plaintext,
            device,
            redacts: None,
            expiry: expires,
            observed_at: now,
        })
    }

    fn defer(&mut self, candidate: (String, Value)) {
        if self.pending.len() < 1024 {
            self.pending.push(candidate);
        }
    }
}

fn sticky_duration(value: &Value) -> Option<u64> {
    value
        .get("msc4354_sticky")
        .or_else(|| value.get("sticky"))
        .and_then(|sticky| sticky.get("duration_ms"))
        .and_then(Value::as_u64)
}

fn sticky_expiry(value: &Value, now: u64) -> StickyExpiry {
    let maximum = u64::from(STICKY_DURATION_MS);
    let duration = sticky_duration(value).unwrap_or(maximum).min(maximum);
    let sent = value
        .get("origin_server_ts")
        .and_then(Value::as_u64)
        .unwrap_or(now)
        .min(now);
    let ttl = value
        .get("unsigned")
        .and_then(|u| {
            u.get("msc4354_sticky_duration_ttl_ms")
                .or_else(|| u.get("sticky_duration_remaining_ms"))
                .or_else(|| u.get("sticky_duration_ttl_ms"))
        })
        .and_then(Value::as_u64);
    ttl.map_or_else(
        || StickyExpiry::Inferred(sent.saturating_add(duration)),
        |ttl| StickyExpiry::Known(now.saturating_add(ttl.min(duration))),
    )
}

pub(crate) fn live_events(room: &Room) -> Vec<Event> {
    sdk_events(
        &room.sticky_events().live(),
        crate::now_ms(),
        &std::collections::HashMap::new(),
    )
}

#[cfg(test)]
pub(super) fn unexpired_events(room: &Room) -> Vec<Event> {
    let (events, leases) = room.sticky_events().snapshot();
    sdk_events(&events, crate::now_ms(), &leases)
}

pub(super) fn merge_sdk(
    room: &Room,
    members: &mut super::membership::StickyMemberships,
    encrypted: bool,
    now: u64,
) {
    let (events, leases) = room.sticky_events().snapshot();
    for (id, lease) in &leases {
        members.record_lease(id.as_str(), lease.expires_at, now);
    }
    for event in sdk_events(&events, now, &leases) {
        event.apply(members, encrypted, now);
    }
}

fn sdk_events(
    events: &[matrix_sdk_base::sticky::StickyEvent],
    observed_at: u64,
    leases: &std::collections::HashMap<OwnedEventId, matrix_sdk_base::sticky::StickyLease>,
) -> Vec<Event> {
    events
        .iter()
        .filter_map(|event| {
            let object: serde_json::Map<String, Value> =
                serde_json::from_str(event.raw().json().get()).ok()?;
            let sticky = if object.contains_key("msc4354_sticky") || object.contains_key("sticky") {
                None
            } else {
                let sent = object.get("origin_server_ts").and_then(Value::as_u64)?;
                let expires = u64::from(event.expires_at.get());
                Some(StickyOut {
                    duration_ms: expires.saturating_sub(sent),
                })
            };
            let value = serde_json::to_value(StampedEventOut {
                event: object,
                msc4354_sticky: sticky,
            })
            .ok()?;
            let device = authenticated_device(event.encryption_info().map(AsRef::as_ref), &value);
            let lease = leases.get(&event.event_id);
            Some(Event {
                expiry: lease.map_or_else(
                    || StickyExpiry::Inferred(u64::from(event.expires_at.get())),
                    |lease| StickyExpiry::Known(lease.expires_at),
                ),
                observed_at: lease.map_or(observed_at, |lease| lease.received_at),
                value,
                device,
                redacts: None,
            })
        })
        .collect()
}

#[derive(serde::Serialize)]
struct StickyOut {
    duration_ms: u64,
}

/// Only stamped when the event lacks both sticky keys, so `event` never
/// carries the key that `msc4354_sticky` would override.
#[derive(serde::Serialize)]
struct StampedEventOut {
    #[serde(flatten)]
    event: serde_json::Map<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    msc4354_sticky: Option<StickyOut>,
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum LeaveCode {
    Leave,
    DelayedLeave,
    SlotClosed,
}

#[derive(serde::Serialize)]
struct LeaveMember {
    id: Option<String>,
    membership: &'static str,
}

#[derive(serde::Serialize)]
struct LeaveReason {
    code: LeaveCode,
}

#[derive(serde::Serialize)]
pub(super) struct LeaveOut {
    slot_id: &'static str,
    member: LeaveMember,
    leave_reason: LeaveReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    msc4354_sticky_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sticky_key: Option<String>,
}

impl LeaveOut {
    #[cfg(test)]
    pub(super) fn new(member_id: Option<String>, code: LeaveCode) -> Self {
        Self::for_wire(member_id, code, super::membership::RtcWire::Deployed)
    }

    pub(super) fn for_wire(
        member_id: Option<String>,
        code: LeaveCode,
        wire: super::membership::RtcWire,
    ) -> Self {
        Self {
            slot_id: wire.slot(),
            member: LeaveMember {
                id: member_id.clone(),
                membership: "leave",
            },
            leave_reason: LeaveReason { code },
            msc4354_sticky_key: (wire == super::membership::RtcWire::Deployed)
                .then(|| member_id.clone())
                .flatten(),
            sticky_key: (wire == super::membership::RtcWire::Stable)
                .then_some(member_id)
                .flatten(),
        }
    }
}

#[cfg(test)]
pub(super) async fn send(
    _client: &Client,
    room: &Room,
    content: impl serde::Serialize,
) -> Result<OwnedEventId, matrix_sdk::Error> {
    send_wire(room, content, super::membership::RtcWire::Deployed).await
}

pub(super) async fn send_wire(
    room: &Room,
    content: impl serde::Serialize,
    wire: super::membership::RtcWire,
) -> Result<OwnedEventId, matrix_sdk::Error> {
    let content = serde_json::to_value(content)?;
    match room.latest_encryption_state().await? {
        matrix_sdk::EncryptionState::NotEncrypted => {}
        state if state.is_encrypted() => {}
        _ => return Err(matrix_sdk::Error::InsufficientData),
    }
    Ok(room
        .send_raw(
            if wire == super::membership::RtcWire::Stable {
                "m.rtc.member"
            } else {
                super::membership::RTC_MEMBER_EVENT_TYPE
            },
            content,
        )
        .with_sticky_duration(Duration::from_millis(STICKY_DURATION_MS.into()))
        .await?
        .response
        .event_id)
}

#[cfg(test)]
pub(super) async fn send_delayed(
    client: &Client,
    support: DelayedEventsSupport,
    room: &Room,
    content: impl serde::Serialize,
    delay: Duration,
) -> Result<String, matrix_sdk::Error> {
    send_delayed_event(
        client,
        support,
        room,
        super::membership::RTC_MEMBER_EVENT_TYPE,
        content,
        delay,
        STICKY_DURATION_MS,
    )
    .await
}

pub(crate) async fn send_delayed_event(
    client: &Client,
    support: DelayedEventsSupport,
    room: &Room,
    event_type: &str,
    content: impl serde::Serialize,
    delay: Duration,
    duration_ms: u32,
) -> Result<String, matrix_sdk::Error> {
    let content = serde_json::value::to_raw_value(&content)?;
    let (event_type, content) = match room.latest_encryption_state().await? {
        matrix_sdk::EncryptionState::NotEncrypted => (event_type.to_owned(), content),
        state if state.is_encrypted() => {
            let raw = Raw::<ruma::events::AnyMessageLikeEventContent>::from_json(content);
            let encrypted = Box::pin(room.encrypt_raw_event(event_type, &raw)).await?;
            ("m.room.encrypted".to_owned(), encrypted.into_json())
        }
        _ => return Err(matrix_sdk::Error::InsufficientData),
    };
    let event = crate::delayed_events::DelayedEvent {
        room_id: room.room_id().to_owned(),
        event_type,
        state_key: None,
        content,
        delay,
        sticky_duration_ms: Some(duration_ms),
    };
    Ok(crate::delayed_events::send(client, support, event).await?)
}

#[cfg(test)]
#[path = "sticky_tests.rs"]
mod tests;
