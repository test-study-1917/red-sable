use base64::Engine as _;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use std::collections::HashMap;

use matrix_sdk::Room;
use matrix_sdk::ruma::events::call::member::{
    ActiveFocus, Application, CallMemberEventContent, CallScope, Focus, MembershipData,
};
use matrix_sdk::ruma::events::sticky::StickyDurationMs;
use matrix_sdk::ruma::{DeviceId, OwnedDeviceId, OwnedServerName, OwnedUserId, ServerName, UserId};
use serde::Deserialize;
use serde_with::{DefaultOnError, serde_as};
use sha2::{Digest as _, Sha256};

use crate::protocol::CallMode;

pub(crate) const RTC_MEMBER_EVENT_TYPE: &str = "org.matrix.msc4143.rtc.member";
pub(crate) const SCREEN_SHARING_FIELD: &str = "org.sable.screen_sharing";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum RtcWire {
    Deployed,
    Stable,
}

impl RtcWire {
    pub(crate) const fn slot(self) -> &'static str {
        match self {
            Self::Deployed => "m.call#ROOM",
            Self::Stable => "m.call#room",
        }
    }
}

pub(crate) fn is_rtc_member_type(event_type: &str) -> bool {
    event_type == RTC_MEMBER_EVENT_TYPE || event_type == "m.rtc.member"
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StickyMember {
    pub(crate) user_id: OwnedUserId,
    pub(crate) device_id: Option<OwnedDeviceId>,
    pub(crate) member_id: String,
    pub(crate) identity: String,
    pub(crate) foci: Vec<String>,
    pub(crate) screen_sharing: bool,
    pub(crate) wire: RtcWire,
    pub(crate) focus_servers: HashMap<String, OwnedServerName>,
}

#[derive(Default)]
pub(crate) struct StickyMemberships {
    entries: HashMap<(OwnedUserId, String, RtcWire, String), StickyEntry>,
    deadlines: StickyDeadlines,
    redacted: HashMap<String, u64>,
}

#[derive(Clone, Copy)]
pub(super) enum StickyExpiry {
    Known(u64),
    Inferred(u64),
}

impl StickyExpiry {
    pub(super) const fn at(self) -> u64 {
        match self {
            Self::Known(at) | Self::Inferred(at) => at,
        }
    }

    fn reconcile(self, incoming: Self) -> Self {
        match (self, incoming) {
            (Self::Known(old), Self::Known(new)) => Self::Known(old.min(new)),
            (Self::Inferred(old), Self::Inferred(new)) => Self::Inferred(old.min(new)),
            (known @ Self::Known(_), Self::Inferred(_))
            | (Self::Inferred(_), known @ Self::Known(_)) => known,
        }
    }
}

#[derive(Default)]
pub(super) struct StickyDeadlines {
    by_event: HashMap<String, StickyDeadline>,
}

struct StickyDeadline {
    expiry: StickyExpiry,
    retain_until: u64,
}

impl StickyDeadlines {
    pub(super) fn prune(&mut self, now: u64) {
        self.by_event
            .retain(|_, deadline| deadline.retain_until > now);
    }

    pub(super) fn record(
        &mut self,
        event_id: &str,
        expiry: StickyExpiry,
        now: u64,
    ) -> StickyExpiry {
        // Another path may still cache a copy with up to an hour left on
        // its original lease. That lease is not the visible deadline.
        let deadline = self
            .by_event
            .entry(event_id.to_owned())
            .or_insert_with(|| StickyDeadline {
                expiry,
                retain_until: now.saturating_add(u64::from(StickyDurationMs::MAX)),
            });
        deadline.expiry = deadline.expiry.reconcile(expiry);
        deadline.retain_until = deadline.retain_until.max(expiry.at());
        deadline.expiry
    }

    pub(super) fn expiry(&self, event_id: &str) -> Option<StickyExpiry> {
        self.by_event.get(event_id).map(|deadline| deadline.expiry)
    }

    pub(super) fn get(&self, event_id: &str) -> Option<u64> {
        self.by_event
            .get(event_id)
            .map(|deadline| deadline.expiry.at())
    }

    #[expect(
        clippy::indexing_slicing,
        reason = "winners are inserted and pruned with their deadlines"
    )]
    fn at(&self, event_id: &str) -> u64 {
        self.by_event[event_id].expiry.at()
    }
}

struct StickyEntry {
    member: Option<StickyMember>,
    departure: Option<StickyDeparture>,
    event_id: String,
    order_expires_at_ms: u64,
    created_ts: u64,
    joined_ts: u64,
}

#[derive(Clone)]
struct StickyDeparture {
    device_id: Option<OwnedDeviceId>,
    joined_ts: u64,
    server_ts: u64,
}

impl StickyEntry {
    fn departure_at(&self, server_ts: u64) -> Option<StickyDeparture> {
        self.departure.clone().or_else(|| {
            let member = self.member.as_ref()?;
            Some(StickyDeparture {
                device_id: member.device_id.clone(),
                joined_ts: self.joined_ts,
                server_ts,
            })
        })
    }
}

#[derive(Debug, Deserialize)]
struct StickyEvent {
    sender: OwnedUserId,
    content: StickyContent,
}

#[derive(Debug, Deserialize)]
struct StickyContent {
    #[serde(default)]
    slot_id: String,
    application: StickyApplication,
    member: Option<StickyMemberRef>,
    #[serde(default)]
    transports: StickyTransports,
    versions: Option<serde::de::IgnoredAny>,
    #[serde(default, rename = "org.sable.screen_sharing")]
    screen_sharing: bool,
}

#[derive(Debug, Deserialize)]
struct StickyApplication {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct StickyMemberRef {
    user_id: Option<OwnedUserId>,
    device_id: Option<OwnedDeviceId>,
    id: String,
    membership: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct StickyTransports {
    #[serde(default)]
    published: Vec<StickyTransport>,
}

#[derive(Debug, Deserialize)]
struct StickyTransport {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    livekit_service_url: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    server_name: Option<OwnedServerName>,
}

pub(crate) fn sticky_member(raw: &str) -> Option<StickyMember> {
    parse_sticky_member(serde_json::from_str(raw).ok()?, None)
}

fn parse_sticky_member(event: StickyEvent, device: Option<&DeviceId>) -> Option<StickyMember> {
    let member = event.content.member?;
    let wire = match event.content.slot_id.as_str() {
        "m.call#ROOM" => RtcWire::Deployed,
        "m.call#room" => RtcWire::Stable,
        _ => return None,
    };
    if event.content.application.kind != "m.call"
        || (wire == RtcWire::Stable && member.membership.as_deref() != Some("join"))
        || member
            .user_id
            .as_ref()
            .is_some_and(|user| user != &event.sender)
    {
        return None;
    }
    if member.id.is_empty() {
        return None;
    }
    let mut foci = Vec::new();
    let mut focus_servers = HashMap::new();
    for transport in event.content.transports.published {
        let url = match wire {
            RtcWire::Deployed if matches!(transport.kind.as_str(), "livekit" | "m.livekit") => {
                transport
                    .livekit_service_url
                    .filter(|url| !url.is_empty())
                    .or_else(|| transport.url.filter(|url| is_sfu_url(url)))
            }
            RtcWire::Stable if transport.kind == "m.livekit" => {
                transport.url.filter(|url| is_sfu_url(url))
            }
            _ => None,
        };
        if let Some(url) = url {
            if is_sfu_url(&url) {
                focus_servers.insert(
                    url.clone(),
                    transport
                        .server_name
                        .unwrap_or_else(|| event.sender.server_name().to_owned()),
                );
            }
            foci.push(url);
        }
    }
    let device_id = device.map(ToOwned::to_owned).or(member.device_id);
    let identity = match wire {
        RtcWire::Deployed if !foci.first().is_some_and(|focus| is_sfu_url(focus)) => {
            let device = device_id.as_deref()?;
            // Element Call up to 0.28.0 requires `versions`; later releases dropped it along with
            // the hashed identity on JWT services.
            if event.content.versions.is_some() {
                sticky_identity(&event.sender, device, &member.id)
            } else {
                super::sfu::livekit_identity(&event.sender, device)
            }
        }
        RtcWire::Deployed | RtcWire::Stable => stable_identity(&event.sender, &member.id),
    };
    Some(StickyMember {
        user_id: event.sender,
        device_id,
        member_id: member.id,
        identity,
        foci,
        screen_sharing: event.content.screen_sharing,
        wire,
        focus_servers,
    })
}

/// A focus is either an SFU's WebSocket URL (MSC4195) or a JWT service's HTTP URL.
pub(crate) fn is_sfu_url(focus: &str) -> bool {
    url::Url::parse(focus).is_ok_and(|url| url.scheme() == "wss")
}

pub(crate) fn backend_identity(
    user_id: &UserId,
    device_id: &DeviceId,
    member_id: &str,
    focus: &str,
) -> String {
    if is_sfu_url(focus) {
        stable_identity(user_id, member_id)
    } else {
        super::sfu::livekit_identity(user_id, device_id)
    }
}

pub(crate) fn stable_identity(user_id: &UserId, member_id: &str) -> String {
    let source = serde_json::Value::from([user_id.as_str(), member_id]).to_string();
    STANDARD_NO_PAD.encode(Sha256::digest(source.as_bytes()))
}

pub(crate) fn sticky_identity(user_id: &UserId, device_id: &DeviceId, member_id: &str) -> String {
    let source =
        serde_json::Value::from([user_id.as_str(), device_id.as_str(), member_id]).to_string();
    STANDARD_NO_PAD.encode(Sha256::digest(source.as_bytes()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CallMember {
    pub(crate) user_id: OwnedUserId,
    pub(crate) device_id: Option<OwnedDeviceId>,
    pub(crate) member_id: Option<String>,
    pub(crate) identity: String,
    pub(crate) mode: CallMode,
    pub(crate) created_ts: u64,
    pub(crate) joined_ts: u64,
    pub(crate) expires_at_ms: Option<u64>,
    pub(crate) sticky_event_id: Option<String>,
    pub(crate) foci: Vec<String>,
    pub(crate) screen_sharing: bool,
    pub(crate) wire: RtcWire,
    pub(crate) focus_servers: HashMap<String, OwnedServerName>,
}

impl CallMember {
    pub(crate) fn is_own(&self, user_id: &UserId, device_id: &DeviceId) -> bool {
        self.user_id == user_id && self.device_id.as_deref() == Some(device_id)
    }

    #[expect(
        clippy::expect_used,
        reason = "The local member has the logged-in device ID"
    )]
    pub(crate) fn own_device_id(&self) -> &DeviceId {
        self.device_id
            .as_deref()
            .expect("own call member has a device ID")
    }

    pub(crate) fn uses_sticky_identity(&self) -> bool {
        self.device_id
            .as_deref()
            .zip(self.member_id.as_deref())
            .is_some_and(|(device, id)| self.identity == sticky_identity(&self.user_id, device, id))
    }

    pub(crate) fn same_generation(&self, other: &Self) -> bool {
        self.user_id == other.user_id
            && self.device_id == other.device_id
            && self.wire == other.wire
            && match (&self.member_id, &other.member_id) {
                (Some(left), Some(right)) => {
                    left == right
                        && match (self.mode, other.mode) {
                            (CallMode::Matrix2, CallMode::Matrix2) => true,
                            (CallMode::Matrix2, _) | (_, CallMode::Matrix2) => false,
                            _ => self.created_ts == other.created_ts,
                        }
                }
                (None, None) => self.created_ts == other.created_ts,
                _ => false,
            }
    }
}

pub(crate) async fn active_members(room: &Room) -> Vec<CallMember> {
    let Ok(events) = room
        .get_state_events_static::<CallMemberEventContent>()
        .await
    else {
        return Vec::new();
    };

    let mut members = Vec::new();
    for raw in events {
        let matrix_sdk::deserialized_responses::RawSyncOrStrippedState::Sync(raw) = raw else {
            continue;
        };
        let Ok(mut value) = raw.deserialize_as::<serde_json::Value>() else {
            continue;
        };
        let membership_id = value
            .get("content")
            .and_then(|content| content.get("membershipID"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        let screen_sharing = value
            .get("content")
            .and_then(|content| content.get(SCREEN_SHARING_FIELD))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        alias_foci(&mut value, room.room_id().as_str());
        let Ok(event) =
            serde_json::from_value::<ruma::events::SyncStateEvent<CallMemberEventContent>>(value)
        else {
            continue;
        };
        let Some(event) = event.as_original() else {
            continue;
        };

        if event.sender != event.state_key.user_id() {
            continue;
        }
        let origin_server_ts = event.origin_server_ts;
        for membership in event.content.active_memberships(Some(origin_server_ts)) {
            let Application::Call(application) = membership.application() else {
                continue;
            };
            if !application.call_id.is_empty() || application.scope != CallScope::Room {
                continue;
            }
            let ActiveFocus::Livekit(focus) = membership.focus_active() else {
                continue;
            };
            let mode = match focus.focus_selection.as_str() {
                "oldest_membership" => CallMode::Legacy,
                "multi_sfu" => CallMode::Compatibility,
                _ => continue,
            };
            let created_ts = membership
                .created_ts()
                .unwrap_or(origin_server_ts)
                .get()
                .into();
            let user_id = event.state_key.user_id();
            let member_id = match membership {
                MembershipData::Legacy(data) => data.membership_id.clone(),
                MembershipData::Session(_) => membership_id
                    .clone()
                    .unwrap_or_else(|| format!("{user_id}:{}", membership.device_id())),
                _ => format!("{user_id}:{}", membership.device_id()),
            };
            let (foci, focus_servers) =
                livekit_foci(membership.foci_preferred(), user_id.server_name());
            members.push(CallMember {
                user_id: user_id.to_owned(),
                device_id: Some(membership.device_id().to_owned()),
                identity: backend_identity(
                    user_id,
                    membership.device_id(),
                    &member_id,
                    foci.first().map_or("", String::as_str),
                ),
                member_id: Some(member_id),
                mode,
                created_ts,
                joined_ts: created_ts,
                expires_at_ms: membership
                    .expires_ts(Some(origin_server_ts))
                    .map(|expires| expires.get().into()),
                sticky_event_id: None,
                foci,
                screen_sharing,
                wire: RtcWire::Deployed,
                focus_servers,
            });
        }
    }
    members
}

fn sticky_timing(
    sticky: Option<StickyField>,
    unsigned: Option<StickyUnsignedIn>,
    created_ts: u64,
    now_ms: u64,
    absolute_expiry: Option<StickyExpiry>,
) -> Option<(u64, StickyExpiry)> {
    let duration = sticky
        .and_then(|sticky| sticky.0?.duration_ms)
        .filter(|duration| *duration != 0)?;
    let order_expires_at_ms = created_ts.saturating_add(duration);
    let capped_duration = duration.min(3_600_000);
    let expiry = absolute_expiry.unwrap_or_else(|| {
        unsigned
            .and_then(|unsigned| unsigned.msc4354_ttl_ms.or(unsigned.ttl_ms)?.0)
            .map_or_else(
                || StickyExpiry::Inferred(now_ms.min(created_ts).saturating_add(capped_duration)),
                |ttl| StickyExpiry::Known(now_ms.saturating_add(ttl.min(capped_duration))),
            )
    });
    Some((order_expires_at_ms, expiry))
}

fn sticky_wire(content: &StickyContentIn, kind: &str, has_stable_key: bool) -> Option<RtcWire> {
    let stable = kind == "m.rtc.member" && has_stable_key;
    match content.rest.get("slot_id") {
        Some(slot) if slot.as_str() == Some(RtcWire::Stable.slot()) && stable => {
            Some(RtcWire::Stable)
        }
        Some(slot) if slot.as_str() == Some(RtcWire::Deployed.slot()) => Some(RtcWire::Deployed),
        None if stable && content.rest.is_empty() => Some(RtcWire::Stable),
        None => Some(RtcWire::Deployed),
        _ => None,
    }
}

fn sticky_tombstone(content: &StickyContentIn, key: &str, wire: RtcWire) -> Option<bool> {
    let member_content = content.rest.get("member");
    let left = member_content
        .and_then(|member| member.get("membership"))
        .is_some_and(|membership| membership.as_str() != Some("join"));
    if left
        && (member_content
            .and_then(|member| member.get("id"))
            .and_then(serde_json::Value::as_str)
            != Some(key)
            || content
                .rest
                .get("slot_id")
                .and_then(serde_json::Value::as_str)
                != Some(wire.slot()))
    {
        return None;
    }
    Some(left || content.rest.keys().all(|field| field == "slot_id"))
}

#[serde_as]
#[derive(Deserialize)]
struct StickyEventIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    content: Option<StickyContentIn>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    sender: Option<OwnedUserId>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    event_id: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    origin_server_ts: Option<u64>,
    #[serde(default, deserialize_with = "sable_model::field::present")]
    msc4354_sticky: Option<StickyField>,
    #[serde(default, deserialize_with = "sable_model::field::present")]
    sticky: Option<StickyField>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    unsigned: Option<StickyUnsignedIn>,
}

#[serde_as]
#[derive(Deserialize)]
struct StickyContentIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    sticky_key: Option<String>,
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    msc4354_sticky_key: Option<String>,
    #[serde(flatten)]
    rest: serde_json::Map<String, serde_json::Value>,
}

#[serde_as]
#[derive(Deserialize)]
struct StickyDurationIn {
    #[serde_as(deserialize_as = "DefaultOnError")]
    #[serde(default)]
    duration_ms: Option<u64>,
}

/// Present even when wrong-typed, so an `.or()` fallback only fires for a missing field.
#[serde_as]
#[derive(Deserialize)]
struct StickyField(#[serde_as(deserialize_as = "DefaultOnError")] Option<StickyDurationIn>);

#[serde_as]
#[derive(Deserialize)]
struct TtlField(#[serde_as(deserialize_as = "DefaultOnError")] Option<u64>);

#[serde_as]
#[derive(Deserialize)]
struct StickyUnsignedIn {
    #[serde(
        default,
        rename = "msc4354_sticky_duration_ttl_ms",
        deserialize_with = "sable_model::field::present"
    )]
    msc4354_ttl_ms: Option<TtlField>,
    #[serde(
        default,
        rename = "sticky_duration_ttl_ms",
        alias = "sticky_duration_remaining_ms",
        deserialize_with = "sable_model::field::present"
    )]
    ttl_ms: Option<TtlField>,
}

#[derive(Clone, Copy)]
pub(super) enum StickyTrust<'a> {
    Plain,
    Untrusted,
    Authenticated(&'a DeviceId),
}

impl StickyTrust<'_> {
    fn can_replace(
        self,
        previous: Option<&StickyMember>,
        member: Option<&serde_json::Value>,
        key: &str,
    ) -> bool {
        match self {
            Self::Plain => true,
            Self::Untrusted => {
                previous.is_none_or(|member| member.device_id.is_none())
                    && member.is_none_or(|member| {
                        member.get("id").and_then(serde_json::Value::as_str) == Some(key)
                    })
            }
            Self::Authenticated(device) => {
                previous.is_none_or(|member| member.device_id.as_deref() == Some(device))
                    && member
                        .and_then(|member| member.get("device_id"))
                        .is_none_or(|claimed| claimed.as_str() == Some(device.as_str()))
            }
        }
    }
}

impl StickyMemberships {
    pub(super) fn record_lease(&mut self, event_id: &str, expires_at: u64, now: u64) {
        self.deadlines
            .record(event_id, StickyExpiry::Known(expires_at), now);
    }

    pub(crate) fn redact(&mut self, event_id: &str, now_ms: u64) {
        self.redacted.retain(|_, expires| *expires > now_ms);
        self.redacted
            .insert(event_id.to_owned(), now_ms.saturating_add(3_600_000));
        for entry in self.entries.values_mut() {
            if entry.event_id == event_id {
                entry.member = None;
            }
        }
    }

    #[cfg(test)]
    fn apply_untrusted(&mut self, value: &serde_json::Value, now_ms: u64) -> bool {
        self.apply_with_trust(value, now_ms, StickyTrust::Untrusted, None)
    }

    #[cfg(test)]
    pub(super) fn apply_authenticated(
        &mut self,
        value: &serde_json::Value,
        device: &DeviceId,
        now_ms: u64,
    ) -> bool {
        self.apply_with_trust(value, now_ms, StickyTrust::Authenticated(device), None)
    }

    #[cfg(test)]
    pub(crate) fn apply(&mut self, value: &serde_json::Value, now_ms: u64) -> bool {
        self.apply_with_trust(value, now_ms, StickyTrust::Plain, None)
    }

    #[expect(
        clippy::too_many_lines,
        reason = "validate and commit one sticky replacement in the same path"
    )]
    pub(super) fn apply_with_trust(
        &mut self,
        value: &serde_json::Value,
        now_ms: u64,
        trust: StickyTrust<'_>,
        observation: Option<(StickyExpiry, u64)>,
    ) -> bool {
        self.deadlines.prune(now_ms);
        // An invisible winner still suppresses lower-ranked cached events.
        self.entries
            .retain(|_, entry| self.deadlines.by_event.contains_key(&entry.event_id));
        self.redacted.retain(|_, expires| *expires > now_ms);
        let Ok(event) = StickyEventIn::deserialize(value) else {
            return false;
        };
        let Some(kind) = event.kind.filter(|kind| is_rtc_member_type(kind)) else {
            return false;
        };
        let Some(content) = event.content else {
            return false;
        };
        let stable_key = content.sticky_key.as_deref();
        let unstable_key = content.msc4354_sticky_key.as_deref();
        if stable_key.is_some() && unstable_key.is_some() && stable_key != unstable_key {
            return false;
        }
        let Some(key) = unstable_key.or(stable_key).filter(|key| !key.is_empty()) else {
            return false;
        };
        let Some(sender) = event.sender else {
            return false;
        };
        let Some(event_id) = event.event_id.as_deref().filter(|id| !id.is_empty()) else {
            return false;
        };
        if self.redacted.contains_key(event_id) {
            return false;
        }
        let Some(created_ts) = event.origin_server_ts else {
            return false;
        };
        let Some((order_expires_at_ms, expiry)) = sticky_timing(
            event.msc4354_sticky.or(event.sticky),
            event.unsigned,
            created_ts,
            now_ms,
            observation.map(|(expiry, _)| expiry),
        ) else {
            return false;
        };
        let Some(wire) = sticky_wire(&content, &kind, stable_key.is_some()) else {
            return false;
        };
        if !matches!(trust, StickyTrust::Plain)
            && wire == RtcWire::Deployed
            && !content.rest.contains_key("slot_id")
        {
            return false;
        }
        let entry_key = (sender, key.to_owned(), wire, kind);
        let observed_at = observation.map_or(now_ms, |(_, received_at)| received_at);
        if observation.is_some() && self.deadlines.by_event.contains_key(event_id) {
            self.deadlines.record(event_id, expiry, now_ms);
        }
        let previous = self.entries.get(&entry_key);
        let active = previous.filter(|entry| self.deadlines.at(&entry.event_id) > observed_at);
        if previous.is_some_and(|old| {
            old.event_id == event_id
                || (order_expires_at_ms, event_id)
                    <= (old.order_expires_at_ms, old.event_id.as_str())
        }) || !trust.can_replace(
            active.and_then(|entry| entry.member.as_ref()),
            content.rest.get("member"),
            key,
        ) {
            return false;
        }
        let device = match trust {
            StickyTrust::Authenticated(device) => Some(device),
            StickyTrust::Plain | StickyTrust::Untrusted => None,
        };
        let Some(tombstone) = sticky_tombstone(&content, key, wire) else {
            return false;
        };
        let member = if tombstone || matches!(trust, StickyTrust::Untrusted) {
            None
        } else {
            let Some(member) = StickyEvent::deserialize(value)
                .ok()
                .and_then(|event| parse_sticky_member(event, device))
                .filter(|member| member.member_id == key)
            else {
                return false;
            };
            Some(member)
        };
        // A winner received before expiry can invalidate older copies even
        // if it expired while the batch was being decoded or applied.
        if self.deadlines.record(event_id, expiry, now_ms).at() <= observed_at {
            return false;
        }
        let departure = previous
            .filter(|_| tombstone)
            .and_then(|entry| entry.departure_at(created_ts));
        let joined_ts = self.joined_ts(&entry_key, member.as_ref(), observed_at, created_ts);
        self.entries.insert(
            entry_key,
            StickyEntry {
                member,
                departure,
                event_id: event_id.to_owned(),
                order_expires_at_ms,
                created_ts,
                joined_ts,
            },
        );
        true
    }

    fn joined_ts(
        &self,
        key: &(OwnedUserId, String, RtcWire, String),
        member: Option<&StickyMember>,
        now_ms: u64,
        created_ts: u64,
    ) -> u64 {
        let Some(member) = member else {
            return created_ts;
        };
        self.entries
            .get(key)
            .filter(|old| self.deadlines.at(&old.event_id) > now_ms)
            .filter(|old| {
                old.member.as_ref().is_some_and(|previous| {
                    previous.member_id == member.member_id && previous.device_id == member.device_id
                })
            })
            .map_or(created_ts, |old| old.joined_ts)
    }

    pub(super) fn observed_expiry(&self, member: &CallMember) -> Option<u64> {
        self.deadlines.get(member.sticky_event_id.as_deref()?)
    }

    pub(super) fn confirmed_departure(&self, member: &CallMember, now: u64) -> Option<u64> {
        let member_id = member.member_id.as_deref()?;
        if member.mode != CallMode::Matrix2 {
            return None;
        }
        let mut departure = None;
        for ((user, id, wire, _), entry) in &self.entries {
            if *user != member.user_id || id != member_id || *wire != member.wire {
                continue;
            }
            if self.deadlines.at(&entry.event_id) > now
                && entry.joined_ts == member.joined_ts
                && entry
                    .member
                    .as_ref()
                    .is_some_and(|active| active.device_id == member.device_id)
            {
                return None;
            }
            if let Some(left) = &entry.departure
                && left.joined_ts == member.joined_ts
                && left.device_id == member.device_id
            {
                departure = Some(
                    departure.map_or(left.server_ts, |before: u64| before.min(left.server_ts)),
                );
            }
        }
        departure
    }

    pub(crate) fn members(&self, now_ms: u64) -> Vec<CallMember> {
        self.entries
            .values()
            .filter(|entry| self.deadlines.at(&entry.event_id) > now_ms)
            .filter_map(|entry| {
                entry.member.as_ref().map(|member| CallMember {
                    user_id: member.user_id.clone(),
                    device_id: member.device_id.clone(),
                    member_id: Some(member.member_id.clone()),
                    identity: member.identity.clone(),
                    mode: CallMode::Matrix2,
                    created_ts: entry.created_ts,
                    joined_ts: entry.joined_ts,
                    expires_at_ms: Some(self.deadlines.at(&entry.event_id)),
                    sticky_event_id: Some(entry.event_id.clone()),
                    foci: member.foci.clone(),
                    screen_sharing: member.screen_sharing,
                    wire: member.wire,
                    focus_servers: member.focus_servers.clone(),
                })
            })
            .collect()
    }
}

fn alias_foci(event: &mut serde_json::Value, room_id: &str) {
    let Some(foci) = event
        .get_mut("content")
        .and_then(|content| content.get_mut("foci_preferred"))
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };
    for focus in foci.iter_mut().filter_map(serde_json::Value::as_object_mut) {
        if focus.get("type").and_then(serde_json::Value::as_str) == Some("livekit")
            && !focus.contains_key("livekit_alias")
        {
            focus.insert("livekit_alias".to_owned(), room_id.into());
        }
    }
}

#[expect(
    deprecated,
    reason = "calls still get their token from the JWT service of the earlier MSC4195"
)]
fn livekit_foci(
    foci: &[Focus],
    sender_server: &ServerName,
) -> (Vec<String>, HashMap<String, OwnedServerName>) {
    let mut urls = Vec::new();
    let mut servers = HashMap::new();
    for focus in foci {
        let (Focus::Livekit(livekit) | Focus::LegacyLivekit(livekit)) = focus else {
            continue;
        };
        if let Some(service) = livekit.service_url.as_ref().filter(|url| !url.is_empty()) {
            urls.push(service.clone());
        } else if let Some(url) = livekit.url.as_ref().filter(|url| is_sfu_url(url)) {
            servers.insert(
                url.clone(),
                livekit
                    .server_name
                    .clone()
                    .unwrap_or_else(|| sender_server.to_owned()),
            );
            urls.push(url.clone());
        }
    }
    (urls, servers)
}

/// SFU URLs are left out: we publish on our own homeserver's, found through discovery.
pub(crate) fn advertised_service_urls(members: &[CallMember]) -> Vec<String> {
    let mut urls: Vec<String> = Vec::new();
    for url in members
        .iter()
        .flat_map(|member| &member.foci)
        .filter(|url| !is_sfu_url(url))
    {
        if !urls.contains(url) {
            urls.push(url.clone());
        }
    }
    urls
}

#[cfg(test)]
#[path = "membership_tests.rs"]
mod tests;
