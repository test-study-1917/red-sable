use std::time::Duration;

use matrix_sdk::{EncryptionState, Room, test_utils::mocks::MatrixMockServer};
use ruma::{api::client::sync::sync_events::msc4186, room_id, serde::Raw};
use serde_json::{Value, json};

use super::super::{State, merge_sdk_sticky};
use super::member;
use crate::{
    calls::{membership::StickyMemberships, sticky::StickySync},
    protocol::CallMode,
};

async fn setup() -> (MatrixMockServer, Room) {
    let server = MatrixMockServer::new().await;
    let client = server.client_builder().build().await;
    let room = server
        .sync_joined_room(&client, room_id!("!sticky-acceptance:example.org"))
        .await;
    server.mock_room_state_encryption().plain().mount().await;
    room.request_encryption_state().await.unwrap();
    assert!(matches!(
        room.encryption_state(),
        EncryptionState::NotEncrypted
    ));
    (server, room)
}

fn rtc_event(id: &str, origin: u64, marker: &str, ttl_field: &str, ttl: u64) -> Value {
    json!({
        "type": "m.rtc.member", "sender": "@other:example.org", "event_id": id,
        "origin_server_ts": origin, (marker): {"duration_ms": 900_000},
        "unsigned": { (ttl_field): ttl },
        "content": {
            "sticky_key": "member", "slot_id": "m.call#room",
            "application": {"type": "m.call"},
            "member": {"user_id": "@other:example.org", "device_id": "PHONE", "id": "member", "membership": "join"},
            "transports": {"published": [{"type": "m.livekit", "url": "wss://sfu.example"}]}
        }
    })
}

fn batch(room: &Room, events: &[Value]) -> msc4186::Response {
    let mut response = msc4186::Response::new("ttl-acceptance".to_owned());
    let mut sticky = msc4186::response::StickyEventsRoom::default();
    sticky.events.extend(
        events
            .iter()
            .map(|event| Raw::new(event).unwrap().cast_unchecked()),
    );
    response
        .extensions
        .sticky_events
        .rooms
        .insert(room.room_id().to_owned(), sticky);
    response
}

async fn sdk_sync(server: &MatrixMockServer, room: &Room, events: &[Value]) {
    let mock = server
        .mock_sliding_sync()
        .ok(batch(room, events))
        .mount_as_scoped()
        .await;
    let mut extension = msc4186::request::StickyEvents::default();
    extension.enabled = Some(true);
    let sync = room
        .client()
        .sliding_sync("ttl-test")
        .unwrap()
        .with_sticky_events_extension(extension)
        .build()
        .await
        .unwrap();
    sync.add_room_subscriptions(&[room.room_id()], None, false);
    sync.sync_once().await.unwrap();
    drop(mock);
}

fn call_state(room: &Room, sticky: StickyMemberships) -> State {
    State::new(
        member(CallMode::Matrix2, 0, &[]),
        Vec::new(),
        sticky,
        &room.room_id().to_owned(),
        false,
        None,
        false,
    )
}

#[tokio::test]
async fn primary_1_older_stable_event_lives_exactly_its_remaining_ttl_in_each_roster() {
    for marker in ["sticky", "msc4354_sticky"] {
        let (server, room) = setup().await;
        let origin = crate::now_ms() - 10_000;
        let event = rtc_event(
            "$member",
            origin,
            marker,
            "sticky_duration_remaining_ms",
            1_000,
        );
        let mock = server
            .mock_sliding_sync()
            .ok(batch(&room, std::slice::from_ref(&event)))
            .mount_as_scoped()
            .await;
        let mut independent = StickySync::new(41);
        let response = independent.poll(&room, Duration::ZERO).await;
        let independent_received = crate::now_ms();
        let events = independent
            .resolve_response(&room, response, independent_received)
            .await
            .unwrap();
        drop(mock);
        let mut independent_members = StickyMemberships::default();
        assert_eq!(events.len(), 1);
        assert!(events[0].apply(&mut independent_members, false, independent_received));
        let independent_counts = (
            independent_members
                .members(independent_received + 999)
                .len(),
            independent_members
                .members(independent_received + 1_000)
                .len(),
        );
        assert_eq!(independent_counts, (1, 0));
        assert_eq!(
            independent_members.members(independent_received)[0].expires_at_ms,
            Some(independent_received + 1_000)
        );

        let sdk_sync_started = crate::now_ms();
        sdk_sync(&server, &room, std::slice::from_ref(&event)).await;
        let sdk_sync_completed = crate::now_ms();
        let mut sdk_members = call_state(&room, StickyMemberships::default());
        merge_sdk_sticky(&room, &mut sdk_members, sdk_sync_completed);
        let (_, leases) = room.sticky_events().snapshot();
        let lease = leases.get(ruma::event_id!("$member")).unwrap();
        assert!((sdk_sync_started..=sdk_sync_completed).contains(&lease.received_at));
        assert_eq!(lease.expires_at, lease.received_at + 1_000);
        assert_eq!(sdk_members.sticky.members(lease.received_at + 999).len(), 1);
        assert_eq!(sdk_members.sticky.members(lease.received_at + 1_000), []);
    }
}

#[tokio::test]
async fn delayed_processing_does_not_restart_the_sdk_lease() {
    let (_, room) = setup().await;
    let received = crate::now_ms() - 500;
    let event = rtc_event(
        "$delayed",
        received - 10_000,
        "sticky",
        "sticky_duration_remaining_ms",
        1_000,
    );
    room.client()
        .process_sliding_sync_test_helper_at(
            ruma::MilliSecondsSinceUnixEpoch(received.try_into().unwrap()),
            &batch(&room, &[event]),
            &matrix_sdk_base::RequestedRequiredStates::default(),
        )
        .await
        .unwrap();
    let mut state = call_state(&room, StickyMemberships::default());
    merge_sdk_sticky(&room, &mut state, crate::now_ms());
    assert_eq!(state.sticky.members(received + 999).len(), 1);
    assert_eq!(state.sticky.members(received + 1_000), []);
}

#[tokio::test]
async fn primary_2_first_sdk_read_at_expiry_reconciles_only_the_same_event() {
    for ttl in [0, 200] {
        let (server, room) = setup().await;
        let origin = crate::now_ms() - 10_000;
        let old = rtc_event(
            "$old",
            origin,
            "msc4354_sticky",
            "msc4354_sticky_duration_ttl_ms",
            60_000,
        );
        let new = rtc_event(
            "$new",
            origin + 1,
            "msc4354_sticky",
            "msc4354_sticky_duration_ttl_ms",
            60_000,
        );
        let mock = server
            .mock_sliding_sync()
            .ok(batch(&room, &[old.clone(), new]))
            .mount_as_scoped()
            .await;
        let mut independent = StickySync::new(42);
        let response = independent.poll(&room, Duration::ZERO).await;
        let independent_received = crate::now_ms();
        let events = independent
            .resolve_response(&room, response, independent_received)
            .await
            .unwrap();
        drop(mock);
        assert_eq!(events.len(), 2);
        let mut old_only = call_state(&room, StickyMemberships::default());
        let mut replaced = call_state(&room, StickyMemberships::default());
        assert!(events[0].apply(&mut old_only.sticky, false, independent_received));
        assert!(events[0].apply(&mut replaced.sticky, false, independent_received));
        assert!(events[1].apply(&mut replaced.sticky, false, independent_received));

        let mut sdk_copy = old;
        sdk_copy["unsigned"]["msc4354_sticky_duration_ttl_ms"] = json!(ttl);
        sdk_sync(&server, &room, &[sdk_copy]).await;
        tokio::time::sleep(Duration::from_millis(ttl + 20)).await;
        let first_read_at = crate::now_ms();
        assert!(first_read_at < independent_received + 60_000);
        merge_sdk_sticky(&room, &mut old_only, first_read_at);
        merge_sdk_sticky(&room, &mut replaced, first_read_at);
        let (visible, leases) = room.sticky_events().snapshot();
        assert!(visible.is_empty());
        assert!(leases[ruma::event_id!("$old")].expires_at <= first_read_at);
        let same_id = old_only.sticky.members(first_read_at);
        let different_id = replaced.sticky.members(first_read_at);
        assert_eq!(different_id.len(), 1);
        assert_eq!(different_id[0].sticky_event_id.as_deref(), Some("$new"));
        assert!(
            same_id.is_empty(),
            "the first SDK snapshot at/after its own deadline must still revoke the independent copy of $old"
        );
    }
}
