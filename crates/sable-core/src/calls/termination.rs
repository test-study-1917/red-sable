//! Admission and retry state for the Element Call end-for-everyone protocol.
//!
//! The caller supplies only events received from the SDK's live sync handler;
//! encrypted events which cannot yet be decrypted remain bound to that session.

use std::collections::{HashSet, VecDeque};

use matrix_sdk::ruma::{OwnedTransactionId, TransactionId};
use serde_json::{Value, json};
use web_time::Instant;

use super::membership::{CallMember, StickyMemberships};

pub(super) const EVENT_TYPE: &str = "io.element.call.reaction";
const TERMINATE: &str = "io.element.call.terminate";
pub(crate) const MODERATE: &str = "io.element.call.moderate";
const GRACE_MS: u64 = 30_000;
const ENCRYPTED_STICKY_WAIT_MS: u64 = 30_000;
const CLOCK_SKEW_MS: u64 = 5_000;
const LIMIT: usize = 256;
const MODERATION_MAX_AGE_MS: u128 = 30_000;

pub(super) struct Candidate {
    event_id: String,
    sender: String,
    ts: u64,
    transaction_id: Option<String>,
}

impl Candidate {
    pub(super) fn parse(event: &Value) -> Option<Self> {
        if event.get("state_key").is_some() || event.pointer("/unsigned/redacted_because").is_some()
        {
            return None;
        }
        let content = event.get("content")?;
        let payload = match event.get("type")?.as_str()? {
            EVENT_TYPE => content.get(TERMINATE)?,
            TERMINATE => content,
            _ => return None,
        };
        let event_id = event.get("event_id")?.as_str()?;
        let sender = event.get("sender")?.as_str()?;
        if event_id.is_empty()
            || sender.is_empty()
            || payload.get("terminated_by")?.as_str()? != sender
            || !positive(payload.get("timestamp")?)
            || payload
                .get("reason")
                .is_some_and(|reason| !reason.is_string())
        {
            return None;
        }
        Some(Self {
            event_id: event_id.to_owned(),
            sender: sender.to_owned(),
            ts: timestamp(event.get("origin_server_ts")?)?,
            transaction_id: event
                .pointer("/unsigned/transaction_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
    }
}

/// Route directed controls on the same live, decrypted room event path as termination.
pub(super) fn moderation(
    event: &Value,
    session: crate::protocol::CallSessionId,
    age_ms: Option<i64>,
    received_at: Instant,
) -> Option<crate::protocol::CoreEvent> {
    if event.get("type")?.as_str()? != EVENT_TYPE
        || event.get("state_key").is_some()
        || event.pointer("/unsigned/redacted_because").is_some()
        || event.get("event_id")?.as_str()?.is_empty()
    {
        return None;
    }
    let content = event.get("content")?;
    let age_at_receipt = u128::from(age_ms.unwrap_or_default().max(0).unsigned_abs());
    if content.get(TERMINATE).is_some()
        || age_at_receipt + received_at.elapsed().as_millis() > MODERATION_MAX_AGE_MS
    {
        return None;
    }
    Some(crate::protocol::CoreEvent::CallControlSignal {
        session,
        sender: event.get("sender")?.as_str()?.to_owned(),
        origin_server_ts: event
            .get("origin_server_ts")?
            .as_u64()
            .filter(|ts| (1..=u64::from(ruma::UInt::MAX)).contains(ts))?,
        requires_confirmation: age_ms.is_none(),
        content: content.get(MODERATE)?.clone(),
    })
}

pub(super) struct LiveEnvelope {
    pub(super) value: Value,
    pub(super) received_at: Instant,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Ended {
    pub(super) terminated_by: String,
    pub(super) event_id: String,
    pub(super) local: bool,
}

#[derive(Clone)]
struct Observed {
    member: CallMember,
    departure: Option<Departure>,
}

#[derive(Clone, Copy)]
struct Departure {
    observed_at: u64,
    server_ts: Option<u64>,
}

#[derive(Clone)]
pub(super) struct Attempt {
    pub(super) transaction_id: OwnedTransactionId,
    pub(super) content: Value,
    pub(super) sending: bool,
}

#[derive(Clone, Copy)]
pub(super) enum MembershipWait {
    RoomRoster { encrypted_sticky: bool },
    EncryptedSticky { since: u64 },
}

pub(super) struct Reader {
    observed: Vec<Observed>,
    local_joined_at: u64,
    accepted: VecDeque<String>,
    pub(super) pending: VecDeque<LiveEnvelope>,
    waiting_for_membership: VecDeque<(Candidate, MembershipWait)>,
    new_membership_candidates: bool,
    pub(super) ended: Option<Ended>,
    pub(super) attempt: Option<Attempt>,
}

/// Preserve the actual local membership before the UI roster substitutes its
/// synthetic `own` entry. Stable RTC memberships can omit the device ID; our
/// own freshly generated membership ID still identifies that entry.
pub(super) fn local_members(members: &[CallMember], own: &CallMember) -> Vec<CallMember> {
    members
        .iter()
        .filter_map(|member| {
            let known_without_device = member.device_id.is_none()
                && member.user_id == own.user_id
                && own.member_id.is_some()
                && member.member_id == own.member_id;
            (member.is_own(&own.user_id, own.own_device_id()) || known_without_device).then(|| {
                let mut member = member.clone();
                if known_without_device {
                    member.device_id.clone_from(&own.device_id);
                }
                member
            })
        })
        .collect()
}

impl Reader {
    pub(super) fn new(own: &CallMember, members: &[CallMember], now: u64) -> Self {
        let mut reader = Self {
            observed: Vec::new(),
            // The synthetic local member is stamped with the client clock.
            // EC starts this boundary only after observing a real membership.
            local_joined_at: 0,
            accepted: VecDeque::new(),
            pending: VecDeque::new(),
            waiting_for_membership: VecDeque::new(),
            new_membership_candidates: false,
            ended: None,
            attempt: None,
        };
        reader.observe(own, members, now);
        reader
    }

    /// Other participants come from the verified UI roster; the local entry
    /// must instead come from the actual membership events.
    pub(super) fn observe_verified(
        &mut self,
        own: &CallMember,
        members: &[CallMember],
        local: Vec<CallMember>,
        now: u64,
    ) {
        let mut observed = members.to_vec();
        observed.retain(|member| {
            !(member.is_own(&own.user_id, own.own_device_id())
                || member.user_id == own.user_id && member.member_id == own.member_id)
        });
        observed.extend(local);
        self.observe(own, &observed, now);
    }

    /// Keep generations, not user IDs, so a rejoin cannot borrow old authority.
    /// Use each active membership event's creation time for admission.
    pub(super) fn observe(&mut self, own: &CallMember, members: &[CallMember], now: u64) {
        self.prune(now);
        let mut current = HashSet::new();
        for member in members {
            if member.is_own(&own.user_id, own.own_device_id()) && member.created_ts > 0 {
                self.local_joined_at = self.local_joined_at.max(member.created_ts);
            }
            if let Some((index, old)) = self
                .observed
                .iter_mut()
                .enumerate()
                .find(|(_, old)| old.member.same_generation(member))
            {
                old.member = member.clone();
                old.departure = None;
                current.insert(index);
            } else {
                let index = self.observed.len();
                self.observed.push(Observed {
                    member: member.clone(),
                    departure: None,
                });
                current.insert(index);
            }
        }
        for (index, old) in self.observed.iter_mut().enumerate() {
            if !current.contains(&index) && old.departure.is_none() {
                old.departure = Some(Departure {
                    observed_at: now,
                    server_ts: None,
                });
            }
        }
        self.prune(now);
    }

    pub(super) fn reconcile_sticky(&mut self, sticky: &StickyMemberships, now: u64) {
        // Even while the room roster is unsynced, update deadlines only for
        // sticky events this reader has already observed.
        for entry in &mut self.observed {
            let expiry = sticky.observed_expiry(&entry.member);
            if let Some(expiry) = expiry {
                entry.member.expires_at_ms = Some(expiry);
            }
            let tombstone = sticky.confirmed_departure(&entry.member, now);
            if tombstone.is_none() && expiry.is_none_or(|at| at > now) {
                continue;
            }
            let departure = entry.departure.get_or_insert(Departure {
                observed_at: now,
                server_ts: None,
            });
            if let Some(server_ts) = tombstone {
                departure.server_ts = Some(
                    departure
                        .server_ts
                        .map_or(server_ts, |old| old.min(server_ts)),
                );
            }
        }
    }

    fn prune(&mut self, now: u64) {
        self.observed.retain(|entry| {
            entry
                .departure
                .is_none_or(|left| now.saturating_sub(left.observed_at) <= GRACE_MS)
        });
        while self
            .observed
            .iter()
            .filter(|entry| entry.departure.is_some())
            .count()
            > LIMIT
        {
            if let Some((index, _)) = self
                .observed
                .iter()
                .enumerate()
                .filter_map(|(index, entry)| entry.departure.map(|left| (index, left.observed_at)))
                .min_by_key(|(_, left)| *left)
            {
                self.observed.remove(index);
            }
        }
    }

    #[cfg(test)]
    pub(super) fn admit(&mut self, value: &Value, now: u64) -> Option<Ended> {
        self.admit_candidate(Candidate::parse(value)?, now, None)
    }

    pub(super) fn admit_candidate(
        &mut self,
        candidate: Candidate,
        now: u64,
        wait: Option<MembershipWait>,
    ) -> Option<Ended> {
        if self.ended.is_some()
            || self.accepted.contains(&candidate.event_id)
            || candidate.ts < self.local_joined_at
        {
            return None;
        }
        let sender = candidate.sender.as_str();
        let ts = candidate.ts;
        self.prune(now);
        let current = self
            .observed
            .iter()
            .any(|entry| entry.member.user_id.as_str() == sender && entry.departure.is_none());
        let authorized = !matches!(wait, Some(MembershipWait::RoomRoster { .. }))
            && self.observed.iter().any(|entry| {
                entry.member.user_id.as_str() == sender
                    && (if current {
                        entry.departure.is_none()
                    } else {
                        entry.departure.is_some_and(|left| {
                            let expired_at = entry
                                .member
                                .expires_at_ms
                                .filter(|expiry| *expiry <= left.observed_at);
                            let cutoff = match (left.server_ts, expired_at) {
                                (Some(left), Some(expiry)) => left.min(expiry),
                                (Some(cutoff), None) | (None, Some(cutoff)) => cutoff,
                                (None, None) => left.observed_at,
                            };
                            now.saturating_sub(left.observed_at) <= GRACE_MS
                                && ts <= cutoff.saturating_add(CLOCK_SKEW_MS)
                        })
                    })
                    && (entry.member.created_ts == 0 || ts >= entry.member.created_ts)
            });
        if !authorized {
            if let Some(wait) = wait
                && !self
                    .waiting_for_membership
                    .iter()
                    .any(|(queued, _)| queued.event_id == candidate.event_id)
            {
                self.waiting_for_membership.push_back((candidate, wait));
                self.new_membership_candidates = true;
                while self.waiting_for_membership.len() > LIMIT {
                    self.waiting_for_membership.pop_front();
                }
            }
            return None;
        }
        let local = self.attempt.as_ref().is_some_and(|attempt| {
            candidate.transaction_id.as_deref() == Some(attempt.transaction_id.as_str())
        });
        let ended = Ended {
            terminated_by: candidate.sender,
            event_id: candidate.event_id.clone(),
            local,
        };
        self.accepted.push_back(candidate.event_id);
        while self.accepted.len() > LIMIT {
            self.accepted.pop_front();
        }
        self.ended = Some(ended.clone());
        Some(ended)
    }

    pub(super) fn waits_for_membership(&self) -> bool {
        !self.waiting_for_membership.is_empty()
    }

    pub(super) const fn new_membership_candidates(&self) -> bool {
        self.new_membership_candidates
    }

    pub(super) const fn membership_check_started(&mut self) {
        self.new_membership_candidates = false;
    }

    pub(super) fn retry_membership(&mut self, now: u64) -> Option<Ended> {
        let ended = std::mem::take(&mut self.waiting_for_membership)
            .into_iter()
            .find_map(|(candidate, wait)| {
                let next_wait = match wait {
                    // Retry once with a synced room roster even if /members
                    // took longer than the separate sticky-decryption wait.
                    MembershipWait::RoomRoster { encrypted_sticky } => {
                        encrypted_sticky.then_some(MembershipWait::EncryptedSticky { since: now })
                    }
                    MembershipWait::EncryptedSticky { since }
                        if now.saturating_sub(since) <= ENCRYPTED_STICKY_WAIT_MS =>
                    {
                        Some(wait)
                    }
                    MembershipWait::EncryptedSticky { .. } => return None,
                };
                self.admit_candidate(candidate, now, next_wait)
            });
        // Requeuing a candidate that still lacks evidence is not new work
        // for the join handoff. Normal call updates will continue to retry it.
        self.new_membership_candidates = false;
        ended
    }

    pub(super) fn clear_pending(&mut self) {
        self.pending.clear();
        self.waiting_for_membership.clear();
        self.new_membership_candidates = false;
    }

    pub(super) fn remember_pending(&mut self, envelope: LiveEnvelope) {
        let Some(id) = envelope.value.get("event_id").and_then(Value::as_str) else {
            return;
        };
        if self
            .pending
            .iter()
            .any(|item| item.value.get("event_id").and_then(Value::as_str) == Some(id))
        {
            return;
        }
        self.pending.push_back(envelope);
        while self.pending.len() > LIMIT {
            self.pending.pop_front();
        }
    }

    pub(super) fn begin_attempt(&mut self, sender: &str, timestamp: u64) -> Option<Attempt> {
        if self.ended.is_some() {
            return None;
        }
        let attempt = self.attempt.get_or_insert_with(|| Attempt {
            transaction_id: TransactionId::new(),
            content: json!({ "io.element.call.terminate": { "terminated_by": sender, "timestamp": timestamp } }),
            sending: false,
        });
        if attempt.sending {
            return None;
        }
        attempt.sending = true;
        Some(attempt.clone())
    }
}

fn positive(value: &Value) -> bool {
    value
        .as_f64()
        .is_some_and(|number| number.is_finite() && number > 0.0)
}

fn timestamp(value: &Value) -> Option<u64> {
    // Server timestamps are compared to integer membership and leave
    // boundaries. An unrepresentable value cannot be a valid sync timestamp.
    if !positive(value) {
        return None;
    }
    value
        .as_u64()
        .or_else(|| value.as_f64()?.floor().to_string().parse().ok())
}

#[cfg(test)]
#[path = "termination_tests.rs"]
mod tests;
