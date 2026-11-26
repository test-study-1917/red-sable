use serde_json::{Value, json};

use super::{Candidate, EVENT_TYPE, MembershipWait, Reader, local_members};
use crate::calls::{
    membership::{CallMember, StickyMemberships},
    runtime::tests::member,
};
use crate::protocol::CallMode;
use matrix_sdk::ruma::{owned_device_id, owned_user_id};
use matrix_sdk_base::RequestedRequiredStates;

fn person(user: &str, device: &str, joined: u64) -> CallMember {
    let mut value = member(CallMode::Compatibility, joined, &[]);
    value.user_id = user.try_into().unwrap();
    value.device_id = Some(device.into());
    value.member_id = Some(format!("{user}:{device}:{joined}"));
    value
}

fn event(sender: &str, ts: u64) -> Value {
    json!({"type": EVENT_TYPE, "event_id":"$end", "sender":sender, "origin_server_ts":ts,
        "content":{"io.element.call.terminate":{"terminated_by":sender,"timestamp":ts}}})
}

fn setup() -> (CallMember, CallMember, Reader) {
    let own = person("@me:example.org", "LOCAL", 100);
    let other = person("@alice:example.org", "ALICE", 120);
    let reader = Reader::new(&own, &[own.clone(), other.clone()], 150);
    (own, other, reader)
}

#[test]
fn accepts_shared_and_legacy_events_and_same_account_other_device() {
    for legacy in [false, true] {
        let (_, other, mut reader) = setup();
        let mut value = event(other.user_id.as_str(), 200);
        if legacy {
            value["type"] = json!("io.element.call.terminate");
            value["content"] = value["content"]["io.element.call.terminate"].clone();
        }
        let ended = reader.admit(&value, 200).unwrap();
        assert_eq!(ended.terminated_by, other.user_id.as_str());
        assert!(!ended.local);
        assert!(reader.admit(&value, 200).is_none());
    }
    let (own, _, mut reader) = setup();
    let mut second = own.clone();
    second.device_id = Some(owned_device_id!("OTHER"));
    second.member_id = Some("other-device".into());
    reader.observe(&own, &[own.clone(), second], 200);
    assert!(
        !reader
            .admit(&event(own.user_id.as_str(), 200), 200)
            .unwrap()
            .local
    );
}

#[test]
fn validates_payload_type_sender_timestamps_and_membership() {
    let (_, other, _) = setup();
    let valid = event(other.user_id.as_str(), 200);
    let mut invalid = Vec::new();
    for (key, replacement) in [
        ("type", json!("m.reaction")),
        ("event_id", json!("")),
        ("origin_server_ts", json!(0)),
        ("origin_server_ts", json!("200")),
        ("sender", json!("@mallory:example.org")),
    ] {
        let mut value = valid.clone();
        value[key] = replacement;
        invalid.push(value);
    }
    for payload in [
        json!({}),
        json!(null),
        json!({"terminated_by":"@alice:example.org","timestamp":0}),
        json!({"terminated_by":"@alice:example.org","timestamp":200,"reason":5}),
    ] {
        let mut value = valid.clone();
        value["content"]["io.element.call.terminate"] = payload;
        invalid.push(value);
    }
    let mut state = valid.clone();
    state["state_key"] = json!("");
    invalid.push(state);
    let mut ordinary = valid;
    ordinary["content"] = json!({"emoji":"👋"});
    invalid.push(ordinary);
    let mut unobserved = event("@bob:example.org", 200);
    unobserved["event_id"] = json!("$bob");
    invalid.push(unobserved);
    for value in invalid {
        let (_, _, mut reader) = setup();
        assert!(reader.admit(&value, 200).is_none(), "{value}");
    }
}

#[test]
fn local_device_join_boundary_and_sender_generation_are_enforced() {
    let (own, mut other, mut reader) = setup();
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 99), 200)
            .is_none()
    );
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 119), 200)
            .is_none()
    );
    let mut earlier_other_device = own.clone();
    earlier_other_device.device_id = Some(owned_device_id!("OTHER"));
    earlier_other_device.joined_ts = 20;
    earlier_other_device.created_ts = 20;
    earlier_other_device.member_id = Some("old-device".into());
    reader.observe(
        &own,
        &[own.clone(), earlier_other_device, other.clone()],
        200,
    );
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 99), 200)
            .is_none()
    );
    reader.observe(&own, std::slice::from_ref(&own), 300);
    other.created_ts = 400;
    other.joined_ts = 400;
    other.member_id = Some("new-generation".into());
    reader.observe(&own, &[own.clone(), other.clone()], 400);
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 250), 400)
            .is_none()
    );
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 400), 400)
            .is_some()
    );

    // The locally fabricated member's wall clock is not a server-observed
    // membership. Another device on the same account is not our boundary.
    let mut own = person("@me:example.org", "LOCAL", 700);
    own.mode = CallMode::Matrix2;
    own.wire = crate::calls::membership::RtcWire::Stable;
    let other = person("@alice:example.org", "ALICE", 120);
    let another_device = person("@me:example.org", "OTHER", 900);
    let mut before_own_echo = Reader::new(&own, &[other.clone(), another_device.clone()], 150);
    assert!(
        before_own_echo
            .admit(&event(other.user_id.as_str(), 200), 200)
            .is_some()
    );

    let mut server_own = own.clone();
    server_own.device_id = None; // Stable RTC may identify our own entry by member ID.
    server_own.created_ts = 300;
    server_own.joined_ts = 100;
    let verified = [own.clone(), another_device.clone(), other.clone()];
    let mut raw = [server_own, another_device, other.clone()];
    let mut reader = Reader::new(&own, std::slice::from_ref(&other), 150);
    reader.observe_verified(&own, &verified, local_members(&raw, &own), 300);
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 299), 300)
            .is_none()
    );
    // Renewal moves the boundary forward even when joined_ts remains stable;
    // seeing an older snapshot afterwards cannot move it backward.
    raw[0].created_ts = 400;
    reader.observe_verified(&own, &verified, local_members(&raw, &own), 400);
    raw[0].created_ts = 200;
    reader.observe_verified(&own, &verified, local_members(&raw, &own), 401);
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 399), 401)
            .is_none()
    );
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 400), 401)
            .is_some()
    );

    // The same real membership also governs a locally echoed send: using the
    // synthetic 700 ms member here would incorrectly reject a 300 ms echo.
    raw[0].created_ts = 300;
    let mut echo_reader = Reader::new(&own, std::slice::from_ref(&other), 150);
    echo_reader.observe_verified(&own, &verified, local_members(&raw, &own), 300);
    assert!(
        echo_reader
            .admit(&event(own.user_id.as_str(), 300), 300)
            .is_some()
    );
}

#[test]
fn departed_grace_and_clock_skew_have_inclusive_boundaries() {
    for (now, ts, accepted) in [
        (30_300, 5_300, true),
        (30_301, 300, false),
        (30_300, 5_301, false),
    ] {
        let (own, other, mut reader) = setup();
        reader.observe(&own, std::slice::from_ref(&own), 300);
        assert_eq!(
            reader
                .admit(&event(other.user_id.as_str(), ts), now)
                .is_some(),
            accepted,
            "now={now} ts={ts}"
        );
    }
}

#[test]
fn retries_reuse_transaction_and_payload_and_only_own_echo_is_local() {
    let (own, _, mut reader) = setup();
    let first = reader.begin_attempt(own.user_id.as_str(), 200).unwrap();
    assert!(reader.begin_attempt(own.user_id.as_str(), 201).is_none());
    reader.attempt.as_mut().unwrap().sending = false;
    let retry = reader.begin_attempt(own.user_id.as_str(), 300).unwrap();
    assert_eq!(retry.transaction_id, first.transaction_id);
    assert_eq!(retry.content, first.content);
    let mut echo = event(own.user_id.as_str(), 200);
    echo["unsigned"] = json!({"transaction_id": first.transaction_id.as_str()});
    assert!(reader.admit(&echo, 200).unwrap().local);
}

#[test]
fn sticky_renewal_advances_membership_boundary_and_pending_is_bounded() {
    let (own, mut other, _) = setup();
    other.mode = CallMode::Matrix2;
    other.member_id = Some("sticky".into());
    let mut reader = Reader::new(&own, &[own.clone(), other.clone()], 150);
    other.created_ts = 250; // refresh of the same sticky membership
    reader.observe(&own, &[own.clone(), other.clone()], 250);
    for i in 0..300 {
        reader.remember_pending(json!({"event_id":format!("${i}")}));
    }
    assert_eq!(reader.pending.len(), 256);
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 200), 250)
            .is_none()
    );
    assert!(
        reader
            .admit(&event(other.user_id.as_str(), 250), 250)
            .is_some()
    );
    assert_eq!(own.user_id, owned_user_id!("@me:example.org"));
}

#[test]
fn decrypted_ends_wait_for_membership_without_relaxing_the_server_timestamp() {
    let own = person("@me:example.org", "LOCAL", 100);
    let mut remote = person("@alice:example.org", "ALICE", 200);
    remote.wire = crate::calls::membership::RtcWire::Stable;
    let sender = remote.user_id.as_str();
    let mut reader = Reader::new(&own, std::slice::from_ref(&own), 300);
    let mut too_old = event(sender, 199);
    too_old["event_id"] = json!("$before-membership");
    for signal in [too_old, event(sender, 220)] {
        assert!(
            reader
                .admit_candidate(
                    Candidate::parse(&signal).unwrap(),
                    300,
                    Some(MembershipWait::EncryptedSticky { since: 300 })
                )
                .is_none()
        );
    }
    assert!(reader.retry_membership(310).is_none());
    reader.observe_verified(&own, std::slice::from_ref(&remote), vec![own.clone()], 320);
    let ended = reader.retry_membership(320).unwrap();
    assert_eq!(ended.event_id, "$end");

    let mut reader = Reader::new(&own, std::slice::from_ref(&own), 300);
    let signal = Candidate::parse(&event(sender, 220)).unwrap();
    assert!(
        reader
            .admit_candidate(
                signal,
                300,
                Some(MembershipWait::EncryptedSticky { since: 300 })
            )
            .is_none()
    );
    reader.observe_verified(&own, &[remote], vec![own.clone()], 30_301);
    assert!(reader.retry_membership(30_301).is_none());
    assert!(!reader.waits_for_membership());
}

#[test]
fn a_slow_room_roster_request_still_rechecks_the_original_end_time() {
    let own = person("@me:example.org", "LOCAL", 100);
    let remote = person("@alice:example.org", "ALICE", 200);
    let mut reader = Reader::new(&own, std::slice::from_ref(&own), 300);
    let mut before_join = event(remote.user_id.as_str(), 199);
    before_join["event_id"] = json!("$before-join");
    for event in [before_join, event(remote.user_id.as_str(), 220)] {
        assert!(
            reader
                .admit_candidate(
                    Candidate::parse(&event).unwrap(),
                    300,
                    Some(MembershipWait::RoomRoster {
                        encrypted_sticky: false
                    }),
                )
                .is_none()
        );
    }
    let synced_at = 31_300;
    reader.observe_verified(&own, &[remote], vec![own.clone()], synced_at);
    assert_eq!(reader.retry_membership(synced_at).unwrap().event_id, "$end");
}

#[test]
fn a_room_roster_delayed_past_sticky_expiry_cannot_extend_end_authority() {
    let own = person("@me:example.org", "LOCAL", 100);
    let mut remote = person("@alice:example.org", "ALICE", 200);
    remote.expires_at_ms = Some(2_000);
    let mut reader = Reader::new(&own, &[own.clone(), remote.clone()], 1_000);
    let mut late = event(remote.user_id.as_str(), 8_000);
    late["event_id"] = json!("$after-expiry");
    for event in [late, event(remote.user_id.as_str(), 1_900)] {
        assert!(
            reader
                .admit_candidate(
                    Candidate::parse(&event).unwrap(),
                    9_000,
                    Some(MembershipWait::RoomRoster {
                        encrypted_sticky: false
                    }),
                )
                .is_none()
        );
    }
    let synced_at = 12_000;
    reader.observe(&own, std::slice::from_ref(&own), synced_at);
    assert_eq!(reader.retry_membership(synced_at).unwrap().event_id, "$end");
}

#[test]
fn a_same_event_expiry_correction_survives_the_batch_and_limits_a_queued_end() {
    for (correction_at, replace_same_key) in [(1_500, false), (12_000, false), (12_000, true)] {
        check_expiry_correction(correction_at, replace_same_key);
    }
}

fn check_expiry_correction(correction_at: u64, replace_same_key: bool) {
    use crate::calls::{
        content,
        membership::{RtcWire, StickyExpiry, StickyTrust},
    };

    let own = person("@me:example.org", "LOCAL", 100);
    let mut remote = person("@alice:example.org", "ALICE", 200);
    remote.mode = CallMode::Matrix2;
    remote.wire = RtcWire::Stable;
    let room_id = ruma::owned_room_id!("!call:example.org");
    let mut membership = json!({
        "type": "m.rtc.member", "event_id": "$remote", "sender": remote.user_id,
        "origin_server_ts": 200, "msc4354_sticky": {"duration_ms": 60_000},
        "content": content::content_at(&room_id, &remote, None, 1_000),
    });
    let mut sticky = StickyMemberships::default();
    assert!(sticky.apply_with_trust(
        &membership,
        1_000,
        StickyTrust::Plain,
        Some((StickyExpiry::Known(23_000), 1_000))
    ));
    let mut observed = sticky.members(1_000);
    observed.push(own.clone());
    let mut reader = Reader::new(&own, &observed, 1_000);
    let correction = |sticky: &mut StickyMemberships| {
        assert!(!sticky.apply_with_trust(
            &membership,
            correction_at,
            StickyTrust::Plain,
            Some((StickyExpiry::Known(2_000), correction_at))
        ));
    };
    if correction_at < 2_000 {
        correction(&mut sticky);
        // An unsynced room can reconcile known sticky events, but it must
        // not seed the reader from the unverified roster.
        reader.reconcile_sticky(&sticky, correction_at);
    }
    let mut late = event(remote.user_id.as_str(), 8_000);
    late["event_id"] = json!("$after-corrected-expiry");
    for event in [late, event(remote.user_id.as_str(), 1_900)] {
        assert!(
            reader
                .admit_candidate(
                    Candidate::parse(&event).unwrap(),
                    9_000,
                    Some(MembershipWait::RoomRoster {
                        encrypted_sticky: false
                    })
                )
                .is_none()
        );
    }

    let batch_at = 12_000;
    if correction_at == batch_at {
        correction(&mut sticky);
    }
    membership["event_id"] = json!("$newer");
    membership["origin_server_ts"] = json!(10_000);
    if !replace_same_key {
        membership["sender"] = json!("@other:example.org");
    }
    assert!(sticky.apply_with_trust(
        &membership,
        batch_at,
        StickyTrust::Plain,
        Some((StickyExpiry::Known(13_000), batch_at))
    ));
    reader.reconcile_sticky(&sticky, batch_at);
    let synced_at = if replace_same_key { 14_000 } else { batch_at };
    reader.reconcile_sticky(&sticky, synced_at);
    reader.observe_verified(
        &own,
        &sticky.members(synced_at),
        vec![own.clone()],
        synced_at,
    );
    assert_eq!(reader.retry_membership(synced_at).unwrap().event_id, "$end");
}

/// These tests exercise the SDK's actual live sync/decryption handler, rather
/// than treating JSON parser fixtures as evidence for Matrix transport.
#[tokio::test]
async fn sdk_plain_live_event_reaches_reader_but_state_and_other_room_do_not() {
    use crate::calls::runtime::{State, watch_termination};
    use crate::protocol::CallSessionId;
    use matrix_sdk::{
        ruma::{events::AnySyncTimelineEvent, room_id, serde::Raw},
        test_utils::mocks::MatrixMockServer,
    };
    use matrix_sdk_test::JoinedRoomBuilder;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    let server = MatrixMockServer::new().await;
    let client = server.client_builder().build().await;
    let room = server
        .sync_joined_room(&client, room_id!("!call:example.org"))
        .await;
    let other_room = server
        .sync_joined_room(&client, room_id!("!other:example.org"))
        .await;
    let own = person(
        client.user_id().unwrap().as_str(),
        client.device_id().unwrap().as_str(),
        100,
    );
    let remote = person("@alice:example.org", "A", 100);
    let state = Arc::new(Mutex::new(
        State::new(
            own.clone(),
            vec![own, remote.clone()],
            StickyMemberships::default(),
            &room.room_id().to_owned(),
            false,
            None,
            false,
        )
        .with_admission_roster(),
    ));
    let core = crate::test_support::session_for(&server, room.client()).await;
    server.mock_get_members().ok(vec![]).mount().await;
    room.sync_members().await.unwrap();
    let _guard = watch_termination(
        &core,
        1,
        CallSessionId(1),
        &room,
        &state,
        Arc::new(tokio::sync::Notify::new()),
        Arc::new(tokio::sync::Notify::new()),
    );
    let raw =
        |value: Value| Raw::<AnySyncTimelineEvent>::from_json_string(value.to_string()).unwrap();
    let mut state_event = event(remote.user_id.as_str(), 200);
    state_event["state_key"] = json!("");
    server
        .sync_room(
            &client,
            JoinedRoomBuilder::new(room.room_id()).add_timeline_event(raw(state_event)),
        )
        .await;
    server
        .sync_room(
            &client,
            JoinedRoomBuilder::new(other_room.room_id())
                .add_timeline_event(raw(event(remote.user_id.as_str(), 200))),
        )
        .await;
    assert!(state.lock().await.termination.ended.is_none());
    server
        .sync_room(
            &client,
            JoinedRoomBuilder::new(room.room_id())
                .add_timeline_event(raw(event(remote.user_id.as_str(), 200))),
        )
        .await;
    assert_eq!(
        state
            .lock()
            .await
            .termination
            .ended
            .as_ref()
            .unwrap()
            .terminated_by,
        remote.user_id.as_str()
    );
}

#[tokio::test]
#[expect(
    clippy::too_many_lines,
    reason = "one SDK fixture verifies same-batch sticky and ordered controls"
)]
async fn sdk_stable_sticky_join_is_visible_to_an_end_in_the_same_sync_batch() {
    use crate::calls::{
        content,
        membership::RtcWire,
        runtime::{State, watch_termination},
    };
    use crate::protocol::CallSessionId;
    use matrix_sdk::{
        ruma::{api::client::sync::sync_events::msc4186, room_id, serde::Raw},
        test_utils::mocks::MatrixMockServer,
    };
    use matrix_sdk_test::{JoinedRoomBuilder, event_factory::EventFactory};
    use std::sync::Arc;
    use tokio::sync::{Mutex, Notify};

    let server = MatrixMockServer::new().await;
    let client = server.client_builder().build().await;
    let room_id = room_id!("!stable:example.org");
    let sender = owned_user_id!("@alice:example.org");
    let factory = EventFactory::new().room(room_id).sender(&sender);
    let room = server
        .sync_room(
            &client,
            JoinedRoomBuilder::new(room_id).add_state_event(factory.member(&sender)),
        )
        .await;
    server.mock_room_state_encryption().plain().mount().await;
    room.request_encryption_state().await.unwrap();
    server
        .mock_get_members()
        .ok(vec![factory.member(&sender).into_raw()])
        .mount()
        .await;
    room.sync_members().await.unwrap();

    let now = crate::now_ms();
    let mut own = person(
        client.user_id().unwrap().as_str(),
        client.device_id().unwrap().as_str(),
        now - 1_000,
    );
    let mut remote = person(sender.as_str(), "ALICE", now - 100);
    for member in [&mut own, &mut remote] {
        member.mode = CallMode::Matrix2;
        member.wire = RtcWire::Stable;
        member.foci = vec!["wss://sfu.example.org".to_owned()];
    }
    let membership = |event_id, member: &CallMember| {
        json!({
            "type": "m.rtc.member", "event_id": event_id, "sender": member.user_id,
            "origin_server_ts": member.created_ts, "msc4354_sticky": {"duration_ms": 3_600_000},
            "content": content::content_at(&room_id.to_owned(), member, None, now),
        })
    };
    let mut sticky = StickyMemberships::default();
    assert!(sticky.apply(&membership("$own", &own), now));
    let state = Arc::new(Mutex::new(State::new(
        own.clone(),
        vec![own],
        sticky,
        &room_id.to_owned(),
        false,
        None,
        false,
    )));
    let core = crate::test_support::session_for(&server, room.client()).await;
    let _guard = watch_termination(
        &core,
        1,
        CallSessionId(1),
        &room,
        &state,
        Arc::new(Notify::new()),
        Arc::new(Notify::new()),
    );

    let mut before_join = event(sender.as_str(), now - 101);
    before_join["event_id"] = json!("$before-join");
    let mut response = msc4186::Response::new("stable-batch".to_owned());
    let mut timeline = msc4186::response::Room::default();
    timeline.timeline = [before_join, event(sender.as_str(), now)]
        .iter()
        .map(|event| Raw::new(event).unwrap().cast_unchecked())
        .collect();
    response.rooms.insert(room_id.to_owned(), timeline);
    let mut sticky = msc4186::response::StickyEventsRoom::default();
    sticky.events.push(
        Raw::new(&membership("$remote", &remote))
            .unwrap()
            .cast_unchecked(),
    );
    response
        .extensions
        .sticky_events
        .rooms
        .insert(room_id.to_owned(), sticky);
    client
        .process_sliding_sync_test_helper(&response, &RequestedRequiredStates::default())
        .await
        .unwrap();

    let state = state.lock().await;
    let ended = state
        .termination
        .ended
        .as_ref()
        .expect("same-batch sticky member can end the call");
    assert_eq!(ended.event_id, "$end");
    assert_eq!(ended.terminated_by, sender.as_str());
}

#[tokio::test]
#[expect(
    clippy::too_many_lines,
    reason = "sets up two real encrypted SDK clients and a rejoin"
)]
async fn sdk_encrypted_event_waits_for_room_key_and_rechecks_join_boundary() {
    use crate::calls::runtime::{State, join_handlers};
    use crate::protocol::CallSessionId;
    use matrix_sdk::{
        ruma::{events::AnySyncTimelineEvent, room_id, serde::Raw},
        test_utils::mocks::MatrixMockServer,
    };
    use matrix_sdk_test::{JoinedRoomBuilder, event_factory::EventFactory};
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path_regex},
    };

    let server = MatrixMockServer::new().await;
    server.mock_crypto_endpoints_preset().await;
    let (alice, bob) = server.set_up_alice_and_bob_for_encryption().await;
    let room_id = room_id!("!call:example.org");
    let f = EventFactory::new()
        .room(room_id)
        .sender(alice.user_id().unwrap());
    for client in [&alice, &bob] {
        server
            .mock_sync()
            .ok_and_run(client, |sync| {
                sync.add_joined_room(
                    JoinedRoomBuilder::new(room_id)
                        .add_state_event(f.room_encryption())
                        .add_state_event(
                            f.member(alice.user_id().unwrap())
                                .sender(alice.user_id().unwrap()),
                        )
                        .add_state_event(
                            f.member(bob.user_id().unwrap())
                                .sender(bob.user_id().unwrap()),
                        ),
                );
            })
            .await;
    }
    server
        .mock_get_members()
        .ok(vec![
            f.member(alice.user_id().unwrap())
                .sender(alice.user_id().unwrap())
                .into_raw(),
            f.member(bob.user_id().unwrap())
                .sender(bob.user_id().unwrap())
                .into_raw(),
        ])
        .mount()
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(r"/rooms/.*/send/m\.room\.encrypted/.*"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"event_id":"$end:example.org"})),
        )
        .mount(server.server())
        .await;
    let (guard, key_event) = server
        .mock_capture_put_to_device(alice.user_id().unwrap())
        .await;
    let alice_room = alice.get_room(room_id).unwrap();
    let payload = json!({"io.element.call.terminate":{"terminated_by":alice.user_id().unwrap(),"timestamp":200}});
    alice_room
        .send_raw(EVENT_TYPE, payload.clone())
        .await
        .unwrap();
    let key_event = key_event.await;
    drop(guard);
    let request = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .find(|request| request.url.path().contains("/send/m.room.encrypted/"))
        .unwrap();
    let ciphertext: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(ciphertext["algorithm"], "m.megolm.v1.aes-sha2");
    assert!(!String::from_utf8_lossy(&request.body).contains("io.element.call.terminate"));

    let room = bob.get_room(room_id).unwrap();
    room.sync_members().await.unwrap();
    let own = person(
        bob.user_id().unwrap().as_str(),
        bob.device_id().unwrap().as_str(),
        100,
    );
    let remote = person(
        alice.user_id().unwrap().as_str(),
        alice.device_id().unwrap().as_str(),
        100,
    );
    let state = Arc::new(Mutex::new(
        State::new(
            own.clone(),
            vec![own.clone(), remote],
            StickyMemberships::default(),
            &room_id.to_owned(),
            false,
            None,
            false,
        )
        .with_admission_roster(),
    ));
    let core = crate::test_support::session_for(&server, room.client()).await;
    let (_wake, _handlers, _keys) =
        join_handlers(&core, 1, CallSessionId(1), &room, &state, false).await;
    let encrypted = json!({"type":"m.room.encrypted", "sender":alice.user_id().unwrap(),
        "event_id":"$end:example.org", "origin_server_ts":200, "content":ciphertext});
    server
        .sync_room(
            &bob,
            JoinedRoomBuilder::new(room_id).add_timeline_event(
                Raw::<AnySyncTimelineEvent>::from_json_string(encrypted.to_string()).unwrap(),
            ),
        )
        .await;
    assert_eq!(state.lock().await.termination.pending.len(), 1);
    assert!(state.lock().await.termination.ended.is_none());
    // A new local membership makes the formerly live ciphertext stale.
    let mut rejoined = own.clone();
    rejoined.created_ts = 300;
    rejoined.joined_ts = 300;
    rejoined.member_id = Some("new-local-generation".into());
    {
        let mut state = state.lock().await;
        state.termination.observe(
            &own,
            &[
                rejoined,
                person(
                    alice.user_id().unwrap().as_str(),
                    alice.device_id().unwrap().as_str(),
                    100,
                ),
            ],
            300,
        );
    }
    server
        .mock_sync()
        .ok_and_run(&bob, |sync| {
            sync.add_to_device_event(key_event.deserialize_as().unwrap());
        })
        .await;
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if state.lock().await.termination.pending.is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    tokio::task::yield_now().await;
    assert!(
        state.lock().await.termination.ended.is_none(),
        "stale decrypted event must not end a rejoined call"
    );
    // Send a fresh encrypted message (a fresh Megolm index, not a replay).
    alice_room.send_raw(EVENT_TYPE, payload).await.unwrap();
    let requests = server.received_requests().await.unwrap();
    let latest = requests
        .iter()
        .rfind(|request| request.url.path().contains("/send/m.room.encrypted/"))
        .unwrap();
    let mut fresh = encrypted;
    fresh["event_id"] = json!("$fresh:example.org");
    fresh["origin_server_ts"] = json!(400);
    fresh["content"] = serde_json::from_slice(&latest.body).unwrap();
    server
        .sync_room(
            &bob,
            JoinedRoomBuilder::new(room_id).add_timeline_event(
                Raw::<AnySyncTimelineEvent>::from_json_string(fresh.to_string()).unwrap(),
            ),
        )
        .await;
    assert_eq!(
        state
            .lock()
            .await
            .termination
            .ended
            .as_ref()
            .unwrap()
            .terminated_by,
        alice.user_id().unwrap().as_str()
    );
}

#[tokio::test]
async fn sdk_retry_reuses_transaction_after_a_lost_response() {
    use matrix_sdk::{config::RequestConfig, ruma::room_id, test_utils::mocks::MatrixMockServer};
    use std::time::Duration;
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path_regex},
    };

    let server = MatrixMockServer::new().await;
    server.mock_room_state_encryption().plain().mount().await;
    let client = server.client_builder().build().await;
    let room = server
        .sync_joined_room(&client, room_id!("!call:example.org"))
        .await;
    let own = person(
        client.user_id().unwrap().as_str(),
        client.device_id().unwrap().as_str(),
        100,
    );
    let mut reader = Reader::new(&own, std::slice::from_ref(&own), 100);
    let attempt = reader.begin_attempt(own.user_id.as_str(), 200).unwrap();
    let first = Mock::given(method("PUT"))
        .and(path_regex(r"/rooms/.*/send/io\.element\.call\.reaction/.*"))
        .respond_with(
            ResponseTemplate::new(500)
                .set_body_json(json!({"errcode":"M_UNKNOWN","error":"response lost"})),
        )
        .mount_as_scoped(server.server())
        .await;
    room.send_raw(EVENT_TYPE, attempt.content.clone())
        .with_transaction_id(&attempt.transaction_id)
        .with_request_config(
            RequestConfig::new()
                .timeout(Duration::from_secs(5))
                .disable_retry(),
        )
        .await
        .unwrap_err();
    drop(first);
    reader.attempt.as_mut().unwrap().sending = false;
    let retry = reader.begin_attempt(own.user_id.as_str(), 300).unwrap();
    Mock::given(method("PUT"))
        .and(path_regex(r"/rooms/.*/send/io\.element\.call\.reaction/.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$sent"})))
        .mount(server.server())
        .await;
    room.send_raw(EVENT_TYPE, retry.content)
        .with_transaction_id(&retry.transaction_id)
        .await
        .unwrap();
    let requests: Vec<_> = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|request| {
            request
                .url
                .path()
                .contains("/send/io.element.call.reaction/")
        })
        .collect();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].url.path(), requests[1].url.path());
    assert_eq!(requests[0].body, requests[1].body);
}

#[tokio::test]
async fn one_owner_takes_the_session_for_concurrent_end_and_leave() {
    use crate::calls::{
        DelayState, membership_state_key,
        runtime::{State, receive_termination},
    };
    use crate::protocol::{CallSessionId, CoreEvent};
    use crate::{CallSession, Core, session::Session, store::MemorySessionStore};
    use matrix_sdk::{ruma::room_id, test_utils::mocks::MatrixMockServer};
    use matrix_sdk_ui::sync_service::SyncService;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    let server = MatrixMockServer::new().await;
    let client = server.client_builder().build().await;
    server.mock_room_state_encryption().plain().mount().await;
    let room = server
        .sync_joined_room(&client, room_id!("!call:example.org"))
        .await;
    let sync_service = Arc::new(SyncService::builder(client.clone()).build().await.unwrap());
    let (core, mut events) = Core::new("test", Box::new(MemorySessionStore::default()));
    crate::test_support::set_session(
        &core,
        Some(Session {
            account_id: "test".into(),
            client: client.clone(),
            sync_service,
            homeserver: server.server().uri(),
            oauth: false,
            state: Arc::default(),
        }),
    );
    let signed_in = core.signed_in().unwrap();
    let own = person(
        client.user_id().unwrap().as_str(),
        client.device_id().unwrap().as_str(),
        100,
    );
    let remote = person("@alice:example.org", "A", 100);
    let state = Arc::new(Mutex::new(
        State::new(
            own.clone(),
            vec![own.clone(), remote.clone()],
            StickyMemberships::default(),
            &room.room_id().to_owned(),
            false,
            None,
            false,
        )
        .with_admission_roster(),
    ));
    let session = CallSessionId(99);
    let membership = signed_in
        .state()
        .call_memberships
        .acquire(core.lifecycle.current(), &room.room_id().to_owned())
        .await;
    signed_in.state().calls.lock().await.insert(
        session,
        CallSession {
            room: room.clone(),
            _membership: membership,
            state_key: membership_state_key(&own.user_id, own.own_device_id(), "11"),
            delay_id: DelayState::shared(None),
            postpone: None,
            updates: None,
            termination_keys: None,
            termination_cancel: tokio::sync::watch::channel(false).0,
            state: state.clone(),
            sticky_member: None,
            handlers: Vec::new(),
        },
    );
    server.mock_get_members().ok(vec![]).mount().await;
    room.sync_members().await.unwrap();
    let signal = event(remote.user_id.as_str(), 200);
    let (_, _, leave) = tokio::join!(
        receive_termination(&signed_in, 1, session, &room, &state, signal.clone()),
        receive_termination(&signed_in, 1, session, &room, &state, signal),
        signed_in.leave_call(session),
    );
    assert!(!signed_in.state().calls.lock().await.contains_key(session));
    tokio::task::yield_now().await;
    let mut ended = 0;
    while let Ok(event) = events.try_recv() {
        if matches!(event, CoreEvent::CallTerminated { .. }) {
            ended += 1;
        }
    }
    assert!(ended <= 1, "one session has only one termination owner");
    if matches!(
        leave.map_err(|error| error.code),
        Err(crate::protocol::RpcCode::UnknownCall)
    ) {
        assert_eq!(ended, 1, "a winning remote end emits exactly once");
    } else {
        assert_eq!(ended, 0, "a winning ordinary leave does not broadcast");
    }
    signed_in.state().session_tasks.lock().clear();
}

#[tokio::test]
async fn event_before_join_grant_is_retained_as_a_typed_normal_end() {
    use crate::calls::runtime::{State, receive_termination, termination_during_join};
    use crate::protocol::{CallSessionId, RpcCode};
    use matrix_sdk::{ruma::room_id, test_utils::mocks::MatrixMockServer};
    use std::sync::Arc;
    use tokio::sync::Mutex;
    let server = MatrixMockServer::new().await;
    let client = server.client_builder().build().await;
    let room = server
        .sync_joined_room(&client, room_id!("!call:example.org"))
        .await;
    let own = person(
        client.user_id().unwrap().as_str(),
        client.device_id().unwrap().as_str(),
        100,
    );
    let remote = person("@alice:example.org", "A", 100);
    let state = Arc::new(Mutex::new(
        State::new(
            own.clone(),
            vec![own, remote.clone()],
            StickyMemberships::default(),
            &room.room_id().to_owned(),
            false,
            None,
            false,
        )
        .with_admission_roster(),
    ));
    let (core, mut events) = crate::test_support::signed_in_core(&server, room.client()).await;
    let signed_in = core.signed_in().unwrap();
    let session = CallSessionId(1);
    server.mock_get_members().ok(vec![]).mount().await;
    room.sync_members().await.unwrap();
    receive_termination(
        &signed_in,
        1,
        session,
        &room,
        &state,
        event(remote.user_id.as_str(), 200),
    )
    .await;
    assert_eq!(
        events.try_recv().unwrap_err(),
        tokio::sync::mpsc::error::TryRecvError::Empty
    );
    let ended = state.lock().await.termination.ended.clone().unwrap();
    assert!(matches!(
        termination_during_join(session, room.room_id().to_owned(), ended).code,
        RpcCode::CallTerminatedDuringJoin {
            session: CallSessionId(1),
            local: false,
            ..
        }
    ));
}

struct RpcFixture {
    server: matrix_sdk::test_utils::mocks::MatrixMockServer,
    core: std::sync::Arc<crate::Core>,
    signed_in: crate::SignedIn,
    room: matrix_sdk::Room,
    state: std::sync::Arc<tokio::sync::Mutex<crate::calls::runtime::State>>,
    session: crate::protocol::CallSessionId,
    events: tokio::sync::mpsc::UnboundedReceiver<crate::protocol::CoreEvent>,
}

async fn rpc_fixture() -> RpcFixture {
    use crate::calls::{DelayState, membership_state_key, runtime::State};
    use crate::protocol::CallSessionId;
    use crate::{CallSession, Core, session::Session, store::MemorySessionStore};
    use matrix_sdk::{ruma::room_id, test_utils::mocks::MatrixMockServer};
    use matrix_sdk_ui::sync_service::SyncService;
    use std::sync::Arc;
    use tokio::sync::Mutex;
    let server = MatrixMockServer::new().await;
    let client = server.client_builder().build().await;
    server.mock_room_state_encryption().plain().mount().await;
    let room = server
        .sync_joined_room(&client, room_id!("!call:example.org"))
        .await;
    let sync_service = Arc::new(SyncService::builder(client.clone()).build().await.unwrap());
    server.mock_get_members().ok(vec![]).mount().await;
    room.sync_members().await.unwrap();
    let (core, events) = Core::new("test", Box::new(MemorySessionStore::default()));
    crate::test_support::set_session(
        &core,
        Some(Session {
            account_id: "test".into(),
            client: client.clone(),
            sync_service,
            homeserver: server.server().uri(),
            oauth: false,
            state: Arc::default(),
        }),
    );
    let signed_in = core.signed_in().unwrap();
    let own = person(
        client.user_id().unwrap().as_str(),
        client.device_id().unwrap().as_str(),
        100,
    );
    let remote = person("@alice:example.org", "A", 100);
    let state = Arc::new(Mutex::new(
        State::new(
            own.clone(),
            vec![own.clone(), remote],
            StickyMemberships::default(),
            &room.room_id().to_owned(),
            false,
            None,
            false,
        )
        .with_admission_roster(),
    ));
    let session = CallSessionId(99);
    let membership = signed_in
        .state()
        .call_memberships
        .acquire(core.lifecycle.current(), &room.room_id().to_owned())
        .await;
    signed_in.state().calls.lock().await.insert(
        session,
        CallSession {
            room: room.clone(),
            _membership: membership,
            state_key: membership_state_key(&own.user_id, own.own_device_id(), "11"),
            delay_id: DelayState::shared(None),
            postpone: None,
            updates: None,
            termination_keys: None,
            termination_cancel: tokio::sync::watch::channel(false).0,
            state: state.clone(),
            sticky_member: None,
            handlers: Vec::new(),
        },
    );
    RpcFixture {
        server,
        core,
        signed_in,
        room,
        state,
        session,
        events,
    }
}

#[tokio::test]
async fn a_limited_sync_can_invalidate_memberships_while_end_admission_waits_for_its_claim() {
    use crate::calls::runtime::receive_termination;
    use matrix_sdk::ruma::api::client::sync::sync_events::msc4186;

    let f = rpc_fixture().await;
    // The key-retry task uses this same admission path independently of sync.
    let calls = f.signed_in.state().calls.lock().await;
    let mut admission = std::pin::pin!(receive_termination(
        &f.signed_in,
        1,
        f.session,
        &f.room,
        &f.state,
        event("@alice:example.org", crate::now_ms()),
    ));
    assert!(futures_util::poll!(&mut admission).is_pending());
    let mut timeline = msc4186::response::Room::default();
    timeline.limited = true;
    let mut response = msc4186::Response::new("limited-before-claim".to_owned());
    response.rooms.insert(f.room.room_id().to_owned(), timeline);
    f.room
        .client()
        .process_sliding_sync_test_helper(&response, &RequestedRequiredStates::default())
        .await
        .unwrap();
    assert!(!f.room.are_members_synced());
    drop(calls);

    assert!(admission.await);
    let state = f.state.lock().await;
    assert!(state.termination.waits_for_membership());
    assert!(state.termination.ended.is_none());
}

async fn wait_for_send(server: &matrix_sdk::test_utils::mocks::MatrixMockServer) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if server
                .received_requests()
                .await
                .unwrap_or_default()
                .iter()
                .any(|request| {
                    request
                        .url
                        .path()
                        .contains("/send/io.element.call.reaction/")
                })
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn production_rpc_retries_the_same_transaction_only_after_failure() {
    use crate::{
        api::calls::EndForEveryoneParams,
        protocol::{CoreEvent, RpcCode},
    };
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path_regex},
    };
    let mut f = rpc_fixture().await;
    let first = Mock::given(method("PUT"))
        .and(path_regex(r"/rooms/.*/send/io\.element\.call\.reaction/.*"))
        .respond_with(
            ResponseTemplate::new(500).set_body_json(json!({"errcode":"M_UNKNOWN","error":"lost"})),
        )
        .mount_as_scoped(f.server.server())
        .await;
    assert!(matches!(
        f.core
            .run(EndForEveryoneParams { session: f.session })
            .await
            .map_err(|error| error.code),
        Err(RpcCode::Unavailable)
    ));
    assert!(
        f.signed_in
            .state()
            .calls
            .lock()
            .await
            .contains_key(f.session)
    );
    assert_eq!(
        f.events.try_recv().unwrap_err(),
        tokio::sync::mpsc::error::TryRecvError::Empty
    );
    drop(first);
    Mock::given(method("PUT"))
        .and(path_regex(r"/rooms/.*/send/io\.element\.call\.reaction/.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$accepted"})))
        .mount(f.server.server())
        .await;
    f.core
        .run(EndForEveryoneParams { session: f.session })
        .await
        .unwrap();
    assert!(
        !f.signed_in
            .state()
            .calls
            .lock()
            .await
            .contains_key(f.session)
    );
    assert!(matches!(
        f.events.recv().await,
        Some(CoreEvent::CallTerminated { local: true, .. })
    ));
    // Cleanup failure does not turn a successful send back into a retryable send.
    assert!(matches!(
        f.core
            .run(EndForEveryoneParams { session: f.session })
            .await
            .map_err(|error| error.code),
        Err(RpcCode::UnknownCall)
    ));
    let requests: Vec<_> = f
        .server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|request| {
            request
                .url
                .path()
                .contains("/send/io.element.call.reaction/")
        })
        .collect();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].url.path(), requests[1].url.path());
    assert_eq!(requests[0].body, requests[1].body);
    f.signed_in.state().session_tasks.lock().clear();
}

#[tokio::test]
async fn production_rpc_busy_and_leave_or_logout_cancel_an_in_flight_send() {
    use crate::{api::calls::EndForEveryoneParams, protocol::RpcCode};
    use std::time::Duration;
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path_regex},
    };
    for logout in [false, true] {
        let f = rpc_fixture().await;
        Mock::given(method("PUT"))
            .and(path_regex(r"/rooms/.*/send/io\.element\.call\.reaction/.*"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_secs(30))
                    .set_body_json(json!({"event_id":"$accepted"})),
            )
            .mount(f.server.server())
            .await;
        let core = f.core.clone();
        let session = f.session;
        let sending = tokio::spawn(async move { core.run(EndForEveryoneParams { session }).await });
        wait_for_send(&f.server).await;
        assert!(matches!(
            f.core
                .run(EndForEveryoneParams { session })
                .await
                .map_err(|error| error.code),
            Err(RpcCode::CallTerminationInProgress)
        ));
        let core = f.core.clone();
        let leaving = tokio::spawn(async move {
            if logout {
                core.logout().await
            } else {
                core.signed_in()?.leave_call(session).await
            }
        });
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(2), sending)
                .await
                .unwrap()
                .unwrap()
                .map_err(|error| error.code),
            Err(RpcCode::UnknownCall | RpcCode::NotLoggedIn)
        ));
        leaving.abort();
        assert!(!f.signed_in.state().calls.lock().await.contains_key(session));
        let requests = f.server.received_requests().await.unwrap();
        assert_eq!(
            requests
                .iter()
                .filter(|request| request
                    .url
                    .path()
                    .contains("/send/io.element.call.reaction/"))
                .count(),
            1
        );
        f.signed_in.state().session_tasks.lock().clear();
    }
}

#[tokio::test]
async fn production_rpc_own_echo_and_response_are_one_normal_end_in_either_order() {
    use crate::calls::runtime::receive_termination;
    use crate::{api::calls::EndForEveryoneParams, protocol::CoreEvent};
    use std::time::Duration;
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path_regex},
    };
    for echo_first in [true, false] {
        let mut f = rpc_fixture().await;
        Mock::given(method("PUT"))
            .and(path_regex(r"/rooms/.*/send/io\.element\.call\.reaction/.*"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(if echo_first {
                        Duration::from_secs(10)
                    } else {
                        Duration::ZERO
                    })
                    .set_body_json(json!({"event_id":"$accepted"})),
            )
            .mount(f.server.server())
            .await;
        let core = f.core.clone();
        let session = f.session;
        let sending = tokio::spawn(async move { core.run(EndForEveryoneParams { session }).await });
        wait_for_send(&f.server).await;
        if echo_first {
            let request = f
                .server
                .received_requests()
                .await
                .unwrap()
                .into_iter()
                .find(|request| {
                    request
                        .url
                        .path()
                        .contains("/send/io.element.call.reaction/")
                })
                .unwrap();
            let transaction = request.url.path_segments().unwrap().next_back().unwrap();
            let sender = f.room.client().user_id().unwrap().to_string();
            let mut echo = event(&sender, crate::now_ms());
            echo["event_id"] = json!("$accepted");
            echo["unsigned"] = json!({"transaction_id":transaction});
            receive_termination(&f.signed_in, 1, session, &f.room, &f.state, echo).await;
        }
        tokio::time::timeout(Duration::from_secs(2), sending)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let ended = tokio::time::timeout(Duration::from_secs(2), f.events.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            ended,
            CoreEvent::CallTerminated { local: true, .. }
        ));
        assert_eq!(
            f.events.try_recv().unwrap_err(),
            tokio::sync::mpsc::error::TryRecvError::Empty
        );
        f.signed_in.state().session_tasks.lock().clear();
    }
}

#[tokio::test]
async fn remote_end_blocks_rejoin_before_the_cleanup_task_runs() {
    use crate::calls::runtime::receive_termination;

    let mut f = rpc_fixture().await;
    let room_id = f.room.room_id().to_owned();
    let generation = f.core.lifecycle.current();
    receive_termination(
        &f.signed_in,
        generation,
        f.session,
        &f.room,
        &f.state,
        event("@alice:example.org", crate::now_ms()),
    )
    .await;

    // The event and session removal already happened. The network task has
    // not run on this current-thread runtime, and publication must still wait.
    assert!(
        !f.signed_in
            .state()
            .calls
            .try_lock()
            .unwrap()
            .contains_key(f.session)
    );
    assert!(matches!(
        f.events.try_recv(),
        Ok(crate::protocol::CoreEvent::CallTerminated { .. })
    ));
    let mut publishing = std::pin::pin!(
        f.signed_in
            .state()
            .call_memberships
            .acquire(generation, &room_id)
    );
    assert!(futures_util::poll!(&mut publishing).is_pending());
    f.core.end_all_calls().await;
    assert!(futures_util::poll!(&mut publishing).is_ready());
}

#[tokio::test]
async fn a_claim_completed_after_account_switch_cannot_signal_on_the_replacement() {
    use crate::session::Session;
    use matrix_sdk::{ruma::event_id, test_utils::mocks::MatrixMockServer};
    use matrix_sdk_ui::sync_service::SyncService;
    use std::sync::Arc;

    let mut f = rpc_fixture().await;
    f.server
        .mock_room_send_state()
        .ok(event_id!("$left"))
        .mount()
        .await;
    let generation = f.core.lifecycle.current();
    let value = event("@alice:example.org", crate::now_ms());
    let claim = f
        .signed_in
        .claim_call_termination(generation, f.session, &f.state, |state| {
            state.termination.admit(&value, crate::now_ms())
        })
        .await
        .unwrap()
        .unwrap();
    let room_id = f.room.room_id().to_owned();
    let next = MatrixMockServer::new().await;
    let client = next.client_builder().build().await;
    next.sync_joined_room(&client, &room_id).await;
    let sync_service = Arc::new(SyncService::builder(client.clone()).build().await.unwrap());
    f.core.lifecycle.set_current(generation + 1);
    f.signed_in.state().session_tasks.lock().clear();
    crate::test_support::set_session(
        &f.core,
        Some(Session {
            account_id: "replacement".into(),
            client,
            sync_service,
            homeserver: next.server().uri(),
            oauth: false,
            state: Arc::default(),
        }),
    );

    f.signed_in.complete_call_termination(claim);
    f.signed_in.end_calls(false).await;
    assert!(f.signed_in.state().session_tasks.lock().is_empty());
    assert_eq!(
        f.events.try_recv().unwrap_err(),
        tokio::sync::mpsc::error::TryRecvError::Empty
    );
    assert!(
        next.server()
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|request| {
                request.method.as_str() != "PUT" || !request.url.path().contains("/state/")
            })
    );
    let mut lease = std::pin::pin!(
        f.signed_in
            .state()
            .call_memberships
            .acquire(generation, &room_id)
    );
    assert!(futures_util::poll!(&mut lease).is_ready());
}

#[tokio::test]
async fn account_retirement_owns_unclaimed_calls_and_awaits_already_claimed_ones() {
    use crate::calls::runtime::receive_termination;
    use std::time::Duration;
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path_regex},
    };

    for claimed_first in [false, true] {
        let mut f = rpc_fixture().await;
        Mock::given(method("PUT"))
            .and(path_regex(r"/rooms/.*/state/.*"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$left"})))
            .expect(1)
            .mount(f.server.server())
            .await;
        let generation = f.core.lifecycle.current();
        let value = event("@alice:example.org", crate::now_ms());
        if claimed_first {
            let claim = f
                .signed_in
                .claim_call_termination(generation, f.session, &f.state, |state| {
                    state.termination.admit(&value, crate::now_ms())
                })
                .await
                .unwrap()
                .unwrap();
            let mut retiring = std::pin::pin!(f.signed_in.end_calls(true));
            assert!(futures_util::poll!(&mut retiring).is_pending());
            f.signed_in.complete_call_termination(claim);
            f.signed_in.state().session_tasks.lock().clear();
            tokio::time::timeout(Duration::from_secs(5), retiring)
                .await
                .unwrap();
        } else {
            {
                let _calls = f.signed_in.state().calls.lock().await;
                f.signed_in.state().call_memberships.retire(generation);
            }
            receive_termination(
                &f.signed_in,
                generation,
                f.session,
                &f.room,
                &f.state,
                value,
            )
            .await;
            assert!(
                f.signed_in
                    .state()
                    .calls
                    .lock()
                    .await
                    .contains_key(f.session)
            );
            f.signed_in.end_calls(true).await;
        }
        assert!(f.signed_in.state().calls.lock().await.is_empty());
        assert_eq!(
            f.events.try_recv().unwrap_err(),
            tokio::sync::mpsc::error::TryRecvError::Empty
        );
        f.server.server().verify().await;
    }
}

#[tokio::test]
async fn rejoin_waits_for_old_membership_cleanup_without_delaying_media_end() {
    use crate::{api::calls::EndForEveryoneParams, protocol::CoreEvent};
    use std::time::Duration;
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path_regex},
    };

    for switch_account in [false, true] {
        let mut f = rpc_fixture().await;
        Mock::given(method("PUT"))
            .and(path_regex(r"/rooms/.*/send/io\.element\.call\.reaction/.*"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$accepted"})))
            .mount(f.server.server())
            .await;
        let cleanup_started = std::sync::Arc::new(tokio::sync::Notify::new());
        let started = cleanup_started.clone();
        Mock::given(method("PUT"))
            .and(path_regex(r"/rooms/.*/state/.*"))
            .respond_with(move |_: &wiremock::Request| {
                started.notify_one();
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_millis(200))
                    .set_body_json(json!({"event_id":"$left"}))
            })
            .mount(f.server.server())
            .await;

        f.core
            .run(EndForEveryoneParams { session: f.session })
            .await
            .unwrap();
        assert!(matches!(
            f.events.recv().await,
            Some(CoreEvent::CallTerminated { .. })
        ));
        tokio::time::timeout(Duration::from_secs(5), cleanup_started.notified())
            .await
            .unwrap();

        let room_id = f.room.room_id().to_owned();
        let generation = f.core.lifecycle.current();
        let mut publishing = std::pin::pin!(
            f.signed_in
                .state()
                .call_memberships
                .acquire(generation, &room_id)
        );
        assert!(futures_util::poll!(&mut publishing).is_pending());
        if switch_account {
            f.core.lifecycle.set_current(generation + 1);
            let replacement = f
                .signed_in
                .state()
                .call_memberships
                .acquire(f.core.lifecycle.current(), &room_id);
            assert!(futures_util::poll!(std::pin::pin!(replacement)).is_ready());
            f.signed_in.state().session_tasks.lock().clear();
            assert!(futures_util::poll!(&mut publishing).is_pending());
        }
        let _lease = tokio::time::timeout(Duration::from_secs(5), publishing)
            .await
            .unwrap();
        f.signed_in.state().session_tasks.lock().clear();
    }
}
