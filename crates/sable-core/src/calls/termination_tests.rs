use serde_json::{Value, json};

use super::{EVENT_TYPE, Reader, local_members};
use crate::calls::{membership::CallMember, runtime::tests::member};
use crate::protocol::CallMode;
use matrix_sdk::ruma::{owned_device_id, owned_user_id};

fn person(user: &str, device: &str, joined: u64) -> CallMember {
    let mut value = member(CallMode::Compatibility, joined, &[]);
    value.user_id = user.try_into().unwrap();
    value.device_id = Some(device.try_into().unwrap());
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
    let mut ordinary = valid.clone();
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

/// These tests exercise the SDK's actual live sync/decryption handler, rather
/// than treating JSON parser fixtures as evidence for Matrix transport.
#[tokio::test]
async fn sdk_plain_live_event_reaches_reader_but_state_and_other_room_do_not() {
    use crate::calls::runtime::{State, watch_termination};
    use crate::protocol::CallSessionId;
    use crate::{Core, store::MemorySessionStore};
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
    let state = Arc::new(Mutex::new(State::new(
        own.clone(),
        vec![own, remote.clone()],
        Default::default(),
        &room.room_id().to_owned(),
        false,
        None,
        false,
    )));
    let (core, _) = Core::new("test", Box::new(MemorySessionStore::default()));
    let _guard = watch_termination(
        &core,
        &client,
        1,
        CallSessionId(1),
        &room,
        &state,
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
async fn sdk_encrypted_event_waits_for_room_key_and_rechecks_join_boundary() {
    use crate::calls::runtime::{State, join_handlers};
    use crate::protocol::CallSessionId;
    use crate::{Core, store::MemorySessionStore};
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
    let state = Arc::new(Mutex::new(State::new(
        own.clone(),
        vec![own.clone(), remote],
        Default::default(),
        &room_id.to_owned(),
        false,
        None,
        false,
    )));
    let (core, _) = Core::new("test", Box::new(MemorySessionStore::default()));
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
        .filter(|request| request.url.path().contains("/send/m.room.encrypted/"))
        .last()
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
    assert!(
        room.send_raw(EVENT_TYPE, attempt.content.clone())
            .with_transaction_id(&attempt.transaction_id)
            .with_request_config(
                RequestConfig::new()
                    .timeout(Duration::from_secs(5))
                    .disable_retry()
            )
            .await
            .is_err()
    );
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
    *core.session.write().await = Some(Session {
        account_id: "test".into(),
        client: client.clone(),
        sync_service,
        homeserver: server.server().uri(),
        oauth: false,
    });
    let own = person(
        client.user_id().unwrap().as_str(),
        client.device_id().unwrap().as_str(),
        100,
    );
    let remote = person("@alice:example.org", "A", 100);
    let state = Arc::new(Mutex::new(State::new(
        own.clone(),
        vec![own.clone(), remote.clone()],
        Default::default(),
        &room.room_id().to_owned(),
        false,
        None,
        false,
    )));
    let session = CallSessionId(99);
    core.call_sessions.lock().await.insert(
        session,
        CallSession {
            room_id: room.room_id().to_owned(),
            state_key: membership_state_key(&own.user_id, own.own_device_id(), "11"),
            delay_id: DelayState::shared(None),
            postpone: None,
            updates: None,
            termination_keys: None,
            termination_cancel: tokio::sync::watch::channel(false).0,
            state: state.clone(),
            sticky_member: None,
            _handlers: Vec::new(),
        },
    );
    let signal = event(remote.user_id.as_str(), 200);
    let ((), (), leave) = tokio::join!(
        receive_termination(&core, 1, session, &room, &state, signal.clone()),
        receive_termination(&core, 1, session, &room, &state, signal),
        core.leave_call(session),
    );
    assert!(!core.call_sessions.lock().await.contains_key(&session));
    tokio::task::yield_now().await;
    let mut ended = 0;
    while let Ok(event) = events.try_recv() {
        if matches!(event, CoreEvent::CallTerminated { .. }) {
            ended += 1;
        }
    }
    assert!(ended <= 1, "one session has only one termination owner");
    if matches!(leave, Err(crate::protocol::RpcError::UnknownCall)) {
        assert_eq!(ended, 1, "a winning remote end emits exactly once");
    } else {
        assert_eq!(ended, 0, "a winning ordinary leave does not broadcast");
    }
    core.session_tasks.lock().clear();
}

#[tokio::test]
async fn event_before_join_grant_is_retained_as_a_typed_normal_end() {
    use crate::calls::runtime::{State, receive_termination, termination_during_join};
    use crate::protocol::{CallSessionId, RpcError};
    use crate::{Core, store::MemorySessionStore};
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
    let state = Arc::new(Mutex::new(State::new(
        own.clone(),
        vec![own, remote.clone()],
        Default::default(),
        &room.room_id().to_owned(),
        false,
        None,
        false,
    )));
    let (core, mut events) = Core::new("test", Box::new(MemorySessionStore::default()));
    let session = CallSessionId(1);
    receive_termination(
        &core,
        1,
        session,
        &room,
        &state,
        event(remote.user_id.as_str(), 200),
    )
    .await;
    assert!(events.try_recv().is_err());
    let ended = state.lock().await.termination.ended.clone().unwrap();
    assert!(matches!(
        termination_during_join(session, room.room_id().to_owned(), ended),
        RpcError::CallTerminatedDuringJoin {
            session: CallSessionId(1),
            local: false,
            ..
        }
    ));
}

struct RpcFixture {
    server: matrix_sdk::test_utils::mocks::MatrixMockServer,
    core: std::sync::Arc<crate::Core>,
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
    let (core, events) = Core::new("test", Box::new(MemorySessionStore::default()));
    *core.session.write().await = Some(Session {
        account_id: "test".into(),
        client: client.clone(),
        sync_service,
        homeserver: server.server().uri(),
        oauth: false,
    });
    let own = person(
        client.user_id().unwrap().as_str(),
        client.device_id().unwrap().as_str(),
        100,
    );
    let remote = person("@alice:example.org", "A", 100);
    let state = Arc::new(Mutex::new(State::new(
        own.clone(),
        vec![own.clone(), remote],
        Default::default(),
        &room.room_id().to_owned(),
        false,
        None,
        false,
    )));
    let session = CallSessionId(99);
    core.call_sessions.lock().await.insert(
        session,
        CallSession {
            room_id: room.room_id().to_owned(),
            state_key: membership_state_key(&own.user_id, own.own_device_id(), "11"),
            delay_id: DelayState::shared(None),
            postpone: None,
            updates: None,
            termination_keys: None,
            termination_cancel: tokio::sync::watch::channel(false).0,
            state: state.clone(),
            sticky_member: None,
            _handlers: Vec::new(),
        },
    );
    RpcFixture {
        server,
        core,
        room,
        state,
        session,
        events,
    }
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
        protocol::{CoreEvent, RpcError},
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
            .await,
        Err(RpcError::Unavailable)
    ));
    assert!(f.core.call_sessions.lock().await.contains_key(&f.session));
    assert!(f.events.try_recv().is_err());
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
    assert!(!f.core.call_sessions.lock().await.contains_key(&f.session));
    assert!(matches!(
        f.events.recv().await,
        Some(CoreEvent::CallTerminated { local: true, .. })
    ));
    // Cleanup failure does not turn a successful send back into a retryable send.
    assert!(matches!(
        f.core
            .run(EndForEveryoneParams { session: f.session })
            .await,
        Err(RpcError::UnknownCall)
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
    f.core.session_tasks.lock().clear();
}

#[tokio::test]
async fn production_rpc_busy_and_leave_or_logout_cancel_an_in_flight_send() {
    use crate::{api::calls::EndForEveryoneParams, protocol::RpcError};
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
            f.core.run(EndForEveryoneParams { session }).await,
            Err(RpcError::CallTerminationInProgress)
        ));
        let core = f.core.clone();
        let leaving = tokio::spawn(async move {
            if logout {
                core.logout().await
            } else {
                core.leave_call(session).await
            }
        });
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(2), sending)
                .await
                .unwrap()
                .unwrap(),
            Err(RpcError::UnknownCall | RpcError::NotLoggedIn)
        ));
        leaving.abort();
        assert!(!f.core.call_sessions.lock().await.contains_key(&session));
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
        f.core.session_tasks.lock().clear();
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
        if !echo_first {
            sending.await.unwrap().unwrap();
        } else {
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
            let transaction = request.url.path_segments().unwrap().last().unwrap();
            let sender = f.room.client().user_id().unwrap().to_string();
            let mut echo = event(&sender, crate::calls::keys::now_ms());
            echo["event_id"] = json!("$accepted");
            echo["unsigned"] = json!({"transaction_id":transaction});
            receive_termination(&f.core, 1, session, &f.room, &f.state, echo).await;
            tokio::time::timeout(Duration::from_secs(2), sending)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        }
        let ended = tokio::time::timeout(Duration::from_secs(2), f.events.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            ended,
            CoreEvent::CallTerminated { local: true, .. }
        ));
        assert!(f.events.try_recv().is_err());
        f.core.session_tasks.lock().clear();
    }
}

#[tokio::test]
async fn rejoin_waits_for_old_membership_cleanup_without_delaying_media_end() {
    use crate::{
        api::calls::EndForEveryoneParams,
        protocol::{CoreEvent, RpcError},
    };
    use std::{sync::atomic::Ordering, time::Duration};
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path_regex},
    };

    for cancel_cleanup in [false, true] {
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
                    .set_delay(if cancel_cleanup {
                        Duration::from_secs(60)
                    } else {
                        Duration::from_millis(200)
                    })
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

        let core = f.core.clone();
        let room_id = f.room.room_id().to_owned();
        let mut joining =
            tokio::spawn(async move { core.join_call(room_id, None, None, None).await });
        // A join may not even discover/publish its new membership while the
        // old state-key deletion is still on the wire.
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut joining)
                .await
                .is_err()
        );
        f.core.session_generation.fetch_add(1, Ordering::SeqCst);
        if cancel_cleanup {
            f.core.session_tasks.lock().clear();
        }
        // Changing accounts while waiting must not join using the new account.
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(5), joining)
                .await
                .unwrap()
                .unwrap(),
            Err(RpcError::NotLoggedIn)
        ));
        assert!(f.core.call_cleanups.lock().await.is_empty());
        f.core.session_tasks.lock().clear();
    }
}
