use std::time::Duration;

use matrix_sdk::test_utils::mocks::MatrixMockServer;
use matrix_sdk_test::async_test;
use ruma::room_id;
use serde_json::json;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{method, path_regex},
};

use super::{
    Event, LeaveCode, LeaveOut, StickyExpiry, StickySync, send, send_delayed, unexpired_events,
};
use crate::delayed_events::DelayedEventsSupport;

async fn room() -> (MatrixMockServer, matrix_sdk::Room) {
    let server = MatrixMockServer::new().await;
    server.mock_room_state_encryption().plain().mount().await;
    let client = server.client_builder().build().await;
    let room = server
        .sync_joined_room(&client, room_id!("!sticky:example.org"))
        .await;
    (server, room)
}

#[test]
fn plaintext_membership_is_rejected_in_encrypted_rooms() {
    let event = Event {
        value: json!({"type":"org.matrix.msc4143.rtc.member", "sender":"@a:example.org", "event_id":"$a", "origin_server_ts":100,
            "msc4354_sticky":{"duration_ms":60000},
            "content":{"msc4354_sticky_key":"member", "slot_id":"m.call#ROOM", "application":{"type":"m.call"},
                "member":{"user_id":"@a:example.org", "device_id":"DEVICE", "id":"member"}}}),
        device: None,
        redacts: None,
        expiry: StickyExpiry::Known(60_100),
        observed_at: 100,
    };
    let mut memberships = crate::calls::membership::StickyMemberships::default();
    assert!(event.apply(&mut memberships, true, 100));
    assert_eq!(
        memberships.members(100),
        Vec::<crate::calls::membership::CallMember>::new()
    );
    let mut memberships = crate::calls::membership::StickyMemberships::default();
    assert!(event.apply(&mut memberships, false, 100));
}

#[test]
fn test_a_leave_names_the_member_and_why_it_left() {
    let leave = |code| serde_json::to_value(LeaveOut::new(Some("member".to_owned()), code));
    assert_eq!(
        leave(LeaveCode::Leave).unwrap(),
        json!({
            "slot_id": "m.call#ROOM",
            "member": {"id": "member", "membership": "leave"},
            "leave_reason": {"code": "leave"},
            "msc4354_sticky_key": "member",
        })
    );
    assert_eq!(
        leave(LeaveCode::DelayedLeave).unwrap()["leave_reason"]["code"],
        "delayed_leave"
    );
}

#[async_test]
async fn test_send_includes_sticky_duration_and_raw_content() {
    let (server, room) = room().await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/rooms/.*/send/org\.matrix\.msc4143\.rtc\.member/.*",
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"event_id": "$sent:example.org"})),
        )
        .mount(server.server())
        .await;

    send(
        &room.client(),
        &room,
        json!({
            "msc4354_sticky_key": "call",
        }),
    )
    .await
    .expect("sticky send");

    let request = server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|request| {
            request
                .url
                .path()
                .contains("/send/org.matrix.msc4143.rtc.member/")
        })
        .expect("send request");
    assert_eq!(request.method, "PUT");
    assert_eq!(request.headers.get("authorization").unwrap(), "Bearer 1234");
    assert_eq!(
        request
            .url
            .query_pairs()
            .find(|(key, _)| key == "org.matrix.msc4354.sticky_duration_ms")
            .unwrap()
            .1,
        "3600000"
    );
    let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["msc4354_sticky_key"], "call");
}

#[async_test]
async fn test_delayed_send_includes_delay_and_sticky_duration() {
    let (server, room) = room().await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/rooms/.*/send/org\.matrix\.msc4143\.rtc\.member/.*",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"delay_id": "$delay"})))
        .mount(server.server())
        .await;

    send_delayed(
        &room.client(),
        DelayedEventsSupport::default(),
        &room,
        json!({"msc4354_sticky_key": "call"}),
        Duration::from_secs(20),
    )
    .await
    .expect("delayed sticky send");

    let request = server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|request| {
            request
                .url
                .path()
                .contains("/send/org.matrix.msc4143.rtc.member/")
        })
        .expect("delayed send request");
    let query = request.url.query_pairs().collect::<Vec<_>>();
    assert!(query.contains(&("org.matrix.msc4140.delay".into(), "20000".into())));
    assert!(query.contains(&(
        "org.matrix.msc4354.sticky_duration_ms".into(),
        "3600000".into()
    )));
    assert_eq!(request.headers.get("authorization").unwrap(), "Bearer 1234");
}

#[async_test]
async fn test_encrypted_delayed_leave_is_not_sent_as_plaintext() {
    let server = MatrixMockServer::new().await;
    server.mock_crypto_endpoints_preset().await;
    Mock::given(method("GET"))
        .and(path_regex(r"/rooms/.*/members"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"chunk": []})))
        .mount(server.server())
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(r"/sendToDevice/.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .mount(server.server())
        .await;
    let (alice, _) = server.set_up_alice_and_bob_for_encryption().await;
    Mock::given(method("GET"))
        .and(path_regex(r"/rooms/.*/state/m\.room\.encryption/?$"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"algorithm":"m.megolm.v1.aes-sha2"})),
        )
        .mount(server.server())
        .await;
    let room = server
        .sync_joined_room(&alice, room_id!("!sticky:example.org"))
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(r"/rooms/.*/send/m\.room\.encrypted/.*"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"delay_id": "$delay", "event_id": "$sent:example.org"})),
        )
        .mount(server.server())
        .await;

    send(&alice, &room, json!({"msc4354_sticky_key": "member"}))
        .await
        .expect("encrypted sticky send");

    send_delayed(
        &alice,
        DelayedEventsSupport::default(),
        &room,
        LeaveOut::new(Some("secret-member".to_owned()), LeaveCode::DelayedLeave),
        Duration::from_secs(20),
    )
    .await
    .expect("encrypted delayed leave");

    let requests = server.received_requests().await.unwrap();
    let membership = requests
        .iter()
        .find(|request| {
            request.url.path().contains("/send/m.room.encrypted/")
                && !request
                    .url
                    .query_pairs()
                    .any(|(key, _)| key == "org.matrix.msc4140.delay")
        })
        .expect("encrypted membership request");
    assert!(
        membership.url.query_pairs().any(|(key, value)| key
            == "org.matrix.msc4354.sticky_duration_ms"
            && value == "3600000")
    );
    let request = requests
        .iter()
        .find(|request| {
            request.url.path().contains("/send/m.room.encrypted/")
                && request
                    .url
                    .query_pairs()
                    .any(|(key, _)| key == "org.matrix.msc4140.delay")
        })
        .expect("encrypted delayed request");
    let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["algorithm"], "m.megolm.v1.aes-sha2");
    assert!(body.get("ciphertext").is_some());
    assert!(!String::from_utf8_lossy(&request.body).contains("secret-member"));
    let event = ruma::serde::Raw::new(&json!({
        "type": "m.room.encrypted", "sender": alice.user_id().unwrap(),
        "event_id": "$delayed", "origin_server_ts": 1, "content": body,
    }))
    .unwrap()
    .cast_unchecked::<ruma::events::room::encrypted::OriginalSyncRoomEncryptedEvent>();
    let decrypted = room.decrypt_event(&event, None).await.unwrap();
    let plaintext: serde_json::Value = serde_json::from_str(decrypted.raw().json().get()).unwrap();
    assert_eq!(plaintext["type"], "org.matrix.msc4143.rtc.member");
    assert_eq!(plaintext["content"]["member"]["id"], "secret-member");
    assert_eq!(plaintext["content"]["member"]["membership"], "leave");
}

#[async_test]
async fn test_sticky_sync_sends_bounded_extensions_and_parses_both_event_locations() {
    let (server, room) = room().await;
    Mock::given(method("POST"))
        .and(path_regex(".*sync.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "pos": "p1",
            "rooms": { room.room_id().as_str(): { "timeline": [{"type":"m.room.message","event_id":"$timeline","sender":"@a:example.org","origin_server_ts":1,"content":{}}] } },
            "extensions": { "org.matrix.msc4354.sticky_events": { "rooms": { room.room_id().as_str(): { "events": [{"type":"m.room.message","event_id":"$sticky","sender":"@a:example.org","origin_server_ts":1,"content":{}}] } } } }
        })))
        .mount(server.server())
        .await;

    let mut sync = StickySync::new(42);
    let events = sync
        .sync(&room, Duration::from_secs(1))
        .await
        .expect("sticky sync");
    assert_eq!(events.len(), 2);

    let request = server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|request| request.method == "POST" && request.url.path().contains("sync"))
        .expect("sync request");
    let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["conn_id"], "call-42");
    assert_eq!(
        body["room_subscriptions"][room.room_id().as_str()]["timeline_limit"],
        0
    );
    assert_eq!(
        body["room_subscriptions"][room.room_id().as_str()]["required_state"],
        json!([["m.room.create", ""]]),
        "Synapse rejects a room subscription without required_state"
    );
    assert_ne!(body["extensions"]["to_device"]["enabled"], true);
    assert_eq!(
        body["extensions"]["org.matrix.msc4354.sticky_events"]["enabled"],
        true
    );
}

#[async_test]
async fn test_sticky_sync_applies_redactions_in_encrypted_rooms() {
    let (server, room) = room().await;
    Mock::given(method("POST"))
        .and(path_regex(".*sync.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "pos": "p1",
            "rooms": { room.room_id().as_str(): { "timeline": [{
                "type": "m.room.redaction", "event_id": "$redaction",
                "sender": "@moderator:example.org", "origin_server_ts": 200,
                "redacts": "$member", "content": {"redacts": "$member"}
            }] } }
        })))
        .mount(server.server())
        .await;
    let mut memberships = crate::calls::membership::StickyMemberships::default();
    let member = json!({
        "type":"m.rtc.member", "event_id":"$member", "sender":"@a:example.org",
        "origin_server_ts":100, "sticky":{"duration_ms":60000},
        "content":{"sticky_key":"member", "slot_id":"m.call#room", "application":{"type":"m.call"},
            "member":{"id":"member", "membership":"join"}}
    });
    assert!(memberships.apply_authenticated(&member, ruma::device_id!("DEVICE"), 100));
    assert_eq!(memberships.members(100).len(), 1);
    let mut sync = StickySync::new(42);
    for event in sync.sync(&room, Duration::ZERO).await.unwrap() {
        assert!(event.apply(&mut memberships, true, 200));
    }
    assert_eq!(
        memberships.members(200),
        Vec::<crate::calls::membership::CallMember>::new()
    );
    assert!(!memberships.apply_authenticated(&member, ruma::device_id!("DEVICE"), 200));
}

#[async_test]
async fn test_sticky_sync_resumes_from_the_connection_position() {
    let (server, room) = room().await;
    Mock::given(method("POST"))
        .and(path_regex(".*sync.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "pos": "p1",
            "extensions": {"org.matrix.msc4354.sticky_events": {}}
        })))
        .expect(1)
        .up_to_n_times(1)
        .with_priority(1)
        .mount(server.server())
        .await;
    Mock::given(method("POST"))
        .and(path_regex(".*sync.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "pos": "p2",
            "extensions": {"org.matrix.msc4354.sticky_events": {}}
        })))
        .mount(server.server())
        .await;
    let mut sync = StickySync::new(1);
    for _ in 0..3 {
        sync.sync(&room, Duration::from_secs(1))
            .await
            .expect("sticky sync");
    }

    let received = server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|request| request.method == "POST" && request.url.path().contains("sync"))
        .collect::<Vec<_>>();
    let positions = received
        .iter()
        .map(|request| {
            request
                .url
                .query_pairs()
                .find(|(key, _)| key == "pos")
                .map(|(_, pos)| pos.into_owned())
        })
        .collect::<Vec<_>>();
    assert_eq!(
        positions,
        [None, Some("p1".to_owned()), Some("p2".to_owned())]
    );
    for request in &received {
        let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
        assert!(
            body["extensions"]["org.matrix.msc4354.sticky_events"]
                .get("since")
                .is_none()
        );
    }
}

#[async_test]
async fn test_sticky_sync_accepts_an_empty_initial_extension_and_keeps_its_position() {
    let (server, room) = room().await;
    Mock::given(method("POST"))
        .and(path_regex(".*sync.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"pos":"p1","rooms":{}})))
        .expect(1)
        .up_to_n_times(1)
        .with_priority(1)
        .mount(server.server())
        .await;
    Mock::given(method("POST"))
        .and(path_regex(".*sync.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "pos":"p2",
            "extensions": {"org.matrix.msc4354.sticky_events": {"next_batch":"s2"}}
        })))
        .mount(server.server())
        .await;
    let mut sync = StickySync::new(2);
    sync.sync(&room, Duration::from_secs(1))
        .await
        .expect("empty initial sync");
    sync.sync(&room, Duration::from_secs(1))
        .await
        .expect("token sync");

    let requests = server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|request| request.method == "POST" && request.url.path().contains("sync"))
        .collect::<Vec<_>>();
    assert_eq!(requests.len(), 2);
    assert_eq!(
        requests[1]
            .url
            .query_pairs()
            .find(|(key, _)| key == "pos")
            .unwrap()
            .1,
        "p1"
    );
    let second: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(
        second["extensions"]["org.matrix.msc4354.sticky_events"]
            .get("since")
            .is_none()
    );
}

#[async_test]
async fn test_delayed_send_refreshes_expired_credentials_and_preserves_sticky_query() {
    use matrix_sdk::{SessionTokens, authentication::matrix::MatrixSession};
    use wiremock::matchers::{header, path};

    let server = MatrixMockServer::new().await;
    Mock::given(method("GET"))
        .and(path_regex(r"/rooms/.*/state/m\.room\.encryption/?$"))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(json!({"errcode":"M_NOT_FOUND", "error":"not encrypted"})),
        )
        .mount(server.server())
        .await;
    let client = server
        .client_builder()
        .unlogged()
        .on_builder(matrix_sdk::ClientBuilder::handle_refresh_tokens)
        .build()
        .await;
    let mut session: MatrixSession = matrix_sdk::test_utils::client::mock_matrix_session();
    session.tokens = SessionTokens {
        access_token: "expired".into(),
        refresh_token: Some("refresh".into()),
    };
    client
        .matrix_auth()
        .restore_session(session, matrix_sdk::store::RoomLoadSettings::default())
        .await
        .unwrap();
    let room = server
        .sync_joined_room(&client, room_id!("!sticky:example.org"))
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/rooms/.*/send/org\.matrix\.msc4143\.rtc\.member/.*",
        ))
        .and(header("authorization", "Bearer expired"))
        .respond_with(ResponseTemplate::new(401).set_body_json(
            json!({"errcode":"M_UNKNOWN_TOKEN", "error":"expired", "soft_logout":true}),
        ))
        .expect(1)
        .mount(server.server())
        .await;
    Mock::given(method("POST"))
        .and(path("/_matrix/client/v3/refresh"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"access_token":"fresh", "refresh_token":"new-refresh"})),
        )
        .expect(1)
        .mount(server.server())
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(
            r"/rooms/.*/send/org\.matrix\.msc4143\.rtc\.member/.*",
        ))
        .and(header("authorization", "Bearer fresh"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"delay_id":"cleanup"})))
        .expect(1)
        .mount(server.server())
        .await;
    assert_eq!(
        send_delayed(
            &client,
            DelayedEventsSupport::default(),
            &room,
            json!({"msc4354_sticky_key":"call"}),
            Duration::from_secs(20)
        )
        .await
        .unwrap(),
        "cleanup"
    );
    let requests = server.received_requests().await.unwrap();
    let sends: Vec<_> = requests
        .iter()
        .filter(|request| {
            request
                .url
                .path()
                .contains("/send/org.matrix.msc4143.rtc.member/")
        })
        .collect();
    assert_eq!(sends.len(), 2);
    assert_eq!(sends[0].url, sends[1].url);
    assert_eq!(sends[0].body, sends[1].body);
    assert!(
        sends[1].url.query_pairs().any(|(key, value)| key
            == "org.matrix.msc4354.sticky_duration_ms"
            && value == "3600000")
    );
}

fn member_batch(
    room: &matrix_sdk::Room,
    origin: u64,
    ttl_field: &str,
    ttl: u64,
) -> ruma::api::client::sync::sync_events::msc4186::Response {
    event_batch(
        room,
        &json!({
            "type": "m.rtc.member", "sender": "@other:example.org", "event_id": "$member",
            "origin_server_ts": origin, "msc4354_sticky": {"duration_ms": 900_000},
            "unsigned": { (ttl_field): ttl },
            "content": {
                "msc4354_sticky_key": "member", "slot_id": "m.call#ROOM",
                "application": {"type": "m.call"},
                "member": {"user_id": "@other:example.org", "device_id": "PHONE", "id": "member"},
                "transports": {"published": [{"type": "livekit", "livekit_service_url": "https://sfu.example"}]}
            }
        }),
    )
}

fn event_batch(
    room: &matrix_sdk::Room,
    value: &serde_json::Value,
) -> ruma::api::client::sync::sync_events::msc4186::Response {
    use ruma::api::client::sync::sync_events::msc4186;

    let mut response = msc4186::Response::new("1".to_owned());
    let mut sticky_room = msc4186::response::StickyEventsRoom::default();
    sticky_room
        .events
        .push(ruma::serde::Raw::new(value).unwrap().cast_unchecked());
    response
        .extensions
        .sticky_events
        .rooms
        .insert(room.room_id().to_owned(), sticky_room);
    response
}

#[async_test]
async fn test_independent_sticky_deadline_survives_delayed_apply_and_later_sdk_receipts() {
    let (_server, room) = room().await;
    let before = crate::now_ms();
    let response = member_batch(&room, before - 10_000, "sticky_duration_ttl_ms", 1_000);
    let event = StickySync::new(1)
        .resolve_response(&room, Ok(response), before)
        .await
        .unwrap()
        .pop()
        .unwrap();
    let expires_at = event.expiry.at();
    assert_eq!(expires_at, before + 1_000);
    let mut delayed = super::super::membership::StickyMemberships::default();
    assert!(event.apply(&mut delayed, false, expires_at));
    assert_eq!(delayed.members(expires_at), []);
    let mut members = super::super::membership::StickyMemberships::default();
    assert!(event.apply(&mut members, false, expires_at - 1));

    let response = member_batch(&room, before - 10_000, "sticky_duration_ttl_ms", 1_000);
    room.client()
        .process_sliding_sync_test_helper(
            &response,
            &matrix_sdk_base::RequestedRequiredStates::default(),
        )
        .await
        .unwrap();
    let cached = unexpired_events(&room).pop().unwrap();
    assert!(cached.expiry.at() >= expires_at);
    assert!(!cached.apply(&mut members, false, expires_at - 1));
    assert_eq!(
        members.members(expires_at - 1)[0].expires_at_ms,
        Some(expires_at)
    );
    assert_eq!(members.members(expires_at), []);
}

#[async_test]
async fn test_tombstone_expiring_between_receipt_and_apply_still_replaces_join() {
    let (_server, room) = room().await;
    let mut sync = StickySync::new(1);
    let response = member_batch(&room, 100, "sticky_duration_ttl_ms", 12_000);
    let joined = sync
        .resolve_response(&room, Ok(response), 1_000)
        .await
        .unwrap()
        .pop()
        .unwrap();
    let mut members = super::super::membership::StickyMemberships::default();
    assert!(joined.apply(&mut members, false, 1_000));
    let observed = members.members(1_000).pop().unwrap();

    for (id, ttl) in [("$expired-on-receipt", 0), ("$leave", 500)] {
        let response = event_batch(
            &room,
            &json!({
                "type": "m.rtc.member", "sender": "@other:example.org", "event_id": id,
                "origin_server_ts": 1_400, "msc4354_sticky": {"duration_ms": 900_000},
                "unsigned": {"sticky_duration_ttl_ms": ttl},
                "content": {"msc4354_sticky_key": "member"}
            }),
        );
        let event = sync
            .resolve_response(&room, Ok(response), 1_500)
            .await
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(event.apply(&mut members, false, 2_000), ttl != 0);
    }
    assert!(!joined.apply(&mut members, false, 8_000));
    assert_eq!(members.members(8_000), []);
    assert_eq!(members.confirmed_departure(&observed, 8_000), Some(1_400));
}

#[async_test]
async fn test_encrypted_sticky_replay_cannot_renew_the_pending_deadline() {
    use matrix_sdk_test::{JoinedRoomBuilder, event_factory::EventFactory};
    use ruma::{events::room::encrypted::OriginalSyncRoomEncryptedEvent, serde::Raw};

    let server = MatrixMockServer::new().await;
    server.mock_crypto_endpoints_preset().await;
    let (alice, bob) = server.set_up_alice_and_bob_for_encryption().await;
    let room_id = room_id!("!sticky:example.org");
    let factory = EventFactory::new()
        .room(room_id)
        .sender(alice.user_id().unwrap());
    for client in [&alice, &bob] {
        server
            .mock_sync()
            .ok_and_run(client, |sync| {
                sync.add_joined_room(
                    JoinedRoomBuilder::new(room_id)
                        .add_state_event(factory.room_encryption())
                        .add_state_event(factory.member(alice.user_id().unwrap()))
                        .add_state_event(factory.member(bob.user_id().unwrap())),
                );
            })
            .await;
    }
    server
        .mock_get_members()
        .ok(vec![
            factory.member(alice.user_id().unwrap()).into_raw(),
            factory.member(bob.user_id().unwrap()).into_raw(),
        ])
        .mount()
        .await;
    Mock::given(method("PUT"))
        .and(path_regex(r"/rooms/.*/send/m\.room\.encrypted/.*"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"event_id":"$encrypted"})))
        .mount(server.server())
        .await;
    let (guard, key_event) = server
        .mock_capture_put_to_device(alice.user_id().unwrap())
        .await;
    let alice_room = alice.get_room(room_id).unwrap();
    send(&alice, &alice_room, json!({
        "msc4354_sticky_key": "member", "slot_id": "m.call#ROOM",
        "application": {"type": "m.call"},
        "member": {"id": "member", "user_id": alice.user_id().unwrap(), "device_id": alice.device_id().unwrap()},
    })).await.unwrap();
    let key_event = key_event.await;
    drop(guard);
    let request = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .find(|request| request.url.path().contains("/send/m.room.encrypted/"))
        .unwrap();
    let encrypted = json!({
        "type": "m.room.encrypted", "event_id": "$encrypted", "sender": alice.user_id().unwrap(),
        "origin_server_ts": 500, "msc4354_sticky": {"duration_ms": 60_000},
        "unsigned": {"msc4354_sticky_duration_ttl_ms": 1_000},
        "content": serde_json::from_slice::<serde_json::Value>(&request.body).unwrap(),
    });
    let room = bob.get_room(room_id).unwrap();
    let mut sync = StickySync::new(1);
    for received_at in [1_000, 1_500] {
        assert!(
            sync.resolve_response(&room, Ok(event_batch(&room, &encrypted)), received_at)
                .await
                .unwrap()
                .is_empty()
        );
    }
    server
        .mock_sync()
        .ok_and_run(&bob, |sync| {
            sync.add_to_device_event(key_event.deserialize_as().unwrap());
        })
        .await;
    let raw = Raw::new(&encrypted)
        .unwrap()
        .cast_unchecked::<OriginalSyncRoomEncryptedEvent>();
    assert!(
        room.decrypt_event(&raw, None)
            .await
            .unwrap()
            .encryption_info()
            .is_some()
    );
    let empty = ruma::api::client::sync::sync_events::msc4186::Response::new("2".to_owned());
    assert!(
        sync.resolve_response(&room, Ok(empty), 2_100)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        sync.resolve_response(&room, Ok(event_batch(&room, &encrypted)), 2_200)
            .await
            .unwrap()
            .is_empty()
    );
}

#[async_test]
async fn test_members_in_the_sdk_sticky_map_feed_the_call() {
    for (field, ttl) in [
        ("msc4354_sticky_duration_ttl_ms", 1_000),
        ("sticky_duration_remaining_ms", 0),
        ("sticky_duration_ttl_ms", 1_000),
    ] {
        let (_server, room) = room().await;
        let now = crate::now_ms();
        let response = member_batch(&room, now, field, ttl);
        room.client()
            .process_sliding_sync_test_helper(
                &response,
                &matrix_sdk_base::RequestedRequiredStates::default(),
            )
            .await
            .unwrap();

        let mut members = super::super::membership::StickyMemberships::default();
        if ttl == 0 {
            let mut earlier: serde_json::Value = serde_json::from_str(
                response.extensions.sticky_events.rooms[room.room_id()].events[0]
                    .json()
                    .get(),
            )
            .unwrap();
            earlier["unsigned"][field] = json!(1_000);
            assert!(members.apply(&earlier, now));
            let at = crate::now_ms();
            super::merge_sdk(&room, &mut members, false, at);
            assert!(members.members(at).is_empty());
            assert!(room.sticky_events().unexpired().is_empty());
            continue;
        }
        let expires_at = u64::from(room.sticky_events().unexpired()[0].expires_at.get());
        let event = unexpired_events(&room).pop().unwrap();
        let imported_at = expires_at - 100;
        assert!(event.apply(&mut members, false, imported_at));
        let member = &members.members(imported_at)[0];
        assert_eq!(member.user_id, "@other:example.org");
        assert_eq!(member.expires_at_ms, Some(expires_at));
        assert!(
            !event.apply(&mut members, false, expires_at),
            "replay must not extend the TTL"
        );
        assert_eq!(members.members(expires_at), []);

        let mut members = super::super::membership::StickyMemberships::default();
        assert!(members.apply(&event.value, imported_at));
        assert!(!event.apply(&mut members, false, imported_at));
        assert_eq!(
            members.members(imported_at)[0].expires_at_ms,
            Some(expires_at)
        );

        let mut members = super::super::membership::StickyMemberships::default();
        assert!(members.apply(&event.value, imported_at));
        assert_eq!(members.members(expires_at).len(), 1);
        assert!(!event.apply(&mut members, false, expires_at));
        assert_eq!(members.members(expires_at), []);

        let mut newer = event.value.clone();
        newer["event_id"] = json!("$newer");
        assert!(members.apply(&newer, expires_at));
        assert!(!event.apply(&mut members, false, expires_at));
        assert_eq!(
            members.members(expires_at)[0].expires_at_ms,
            Some(expires_at + ttl)
        );
    }
}
