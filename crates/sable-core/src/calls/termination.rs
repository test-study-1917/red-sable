//! Admission and retry state for the Element Call end-for-everyone protocol.
//!
//! The caller supplies only events received from the SDK's live sync handler;
//! encrypted events which cannot yet be decrypted remain bound to that session.

use std::collections::{HashSet, VecDeque};

use matrix_sdk::ruma::{OwnedTransactionId, TransactionId};
use serde_json::{Value, json};

use super::membership::CallMember;

pub(super) const EVENT_TYPE: &str = "io.element.call.reaction";
const TERMINATE: &str = "io.element.call.terminate";
const GRACE_MS: u64 = 30_000;
const CLOCK_SKEW_MS: u64 = 5_000;
const LIMIT: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Ended {
    pub(super) terminated_by: String,
    pub(super) event_id: String,
    pub(super) local: bool,
}

#[derive(Clone)]
struct Observed {
    member: CallMember,
    left_at: Option<u64>,
}

#[derive(Clone)]
pub(super) struct Attempt {
    pub(super) transaction_id: OwnedTransactionId,
    pub(super) content: Value,
    pub(super) sending: bool,
}

pub(super) struct Reader {
    observed: Vec<Observed>,
    local_joined_at: u64,
    accepted: VecDeque<String>,
    pub(super) pending: VecDeque<Value>,
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
            if member.is_own(&own.user_id, own.own_device_id()) || known_without_device {
                let mut member = member.clone();
                if known_without_device {
                    member.device_id.clone_from(&own.device_id);
                }
                Some(member)
            } else {
                None
            }
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
                old.left_at = None;
                current.insert(index);
            } else {
                let index = self.observed.len();
                self.observed.push(Observed {
                    member: member.clone(),
                    left_at: None,
                });
                current.insert(index);
            }
        }
        for (index, old) in self.observed.iter_mut().enumerate() {
            if !current.contains(&index) && old.left_at.is_none() {
                old.left_at = Some(now);
            }
        }
        self.prune(now);
    }

    fn prune(&mut self, now: u64) {
        self.observed.retain(|entry| {
            entry
                .left_at
                .is_none_or(|left| now.saturating_sub(left) <= GRACE_MS)
        });
        while self
            .observed
            .iter()
            .filter(|entry| entry.left_at.is_some())
            .count()
            > LIMIT
        {
            if let Some((index, _)) = self
                .observed
                .iter()
                .enumerate()
                .filter_map(|(index, entry)| entry.left_at.map(|left| (index, left)))
                .min_by_key(|(_, left)| *left)
            {
                self.observed.remove(index);
            }
        }
    }

    pub(super) fn admit(&mut self, value: &Value, now: u64) -> Option<Ended> {
        if self.ended.is_some()
            || value.get("state_key").is_some()
            || value.pointer("/unsigned/redacted_because").is_some()
        {
            return None;
        }
        let event_id = value.get("event_id")?.as_str()?.to_owned();
        if event_id.is_empty() || self.accepted.contains(&event_id) {
            return None;
        }
        let sender = value.get("sender")?.as_str()?;
        if sender.is_empty() {
            return None;
        }
        let ts = timestamp(value.get("origin_server_ts")?)?;
        let content = value.get("content")?;
        let payload = match value.get("type")?.as_str()? {
            EVENT_TYPE => content.get(TERMINATE)?,
            TERMINATE => content,
            _ => return None,
        };
        if payload.get("terminated_by")?.as_str()? != sender || !positive(payload.get("timestamp")?)
        {
            return None;
        }
        if payload
            .get("reason")
            .is_some_and(|reason| !reason.is_string())
        {
            return None;
        }
        if ts < self.local_joined_at {
            return None;
        }
        self.prune(now);
        let current = self
            .observed
            .iter()
            .any(|entry| entry.member.user_id.as_str() == sender && entry.left_at.is_none());
        let authorized = self.observed.iter().any(|entry| {
            entry.member.user_id.as_str() == sender
                && (if current {
                    entry.left_at.is_none()
                } else {
                    entry.left_at.is_some_and(|left| {
                        now.saturating_sub(left) <= GRACE_MS
                            && ts <= left.saturating_add(CLOCK_SKEW_MS)
                    })
                })
                && (entry.member.created_ts == 0 || ts >= entry.member.created_ts)
        });
        if !authorized {
            return None;
        }
        let txn = value
            .pointer("/unsigned/transaction_id")
            .and_then(Value::as_str);
        let local = self
            .attempt
            .as_ref()
            .is_some_and(|attempt| txn == Some(attempt.transaction_id.as_str()));
        let ended = Ended {
            terminated_by: sender.to_owned(),
            event_id: event_id.clone(),
            local,
        };
        self.accepted.push_back(event_id);
        while self.accepted.len() > LIMIT {
            self.accepted.pop_front();
        }
        self.ended = Some(ended.clone());
        Some(ended)
    }

    pub(super) fn remember_pending(&mut self, value: Value) {
        let Some(id) = value.get("event_id").and_then(Value::as_str) else {
            return;
        };
        if self
            .pending
            .iter()
            .any(|item| item.get("event_id").and_then(Value::as_str) == Some(id))
        {
            return;
        }
        self.pending.push_back(value);
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
