use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};

use matrix_sdk::ruma::OwnedRoomId;
use parking_lot::Mutex;
use tokio::sync::{Mutex as RoomGate, OwnedMutexGuard};

type RoomGates = HashMap<(u64, OwnedRoomId), Weak<RoomGate<()>>>;

#[derive(Default)]
pub(crate) struct RoomMemberships {
    rooms: Mutex<RoomGates>,
    retired_through: AtomicU64,
}

/// Owns the room's local Matrix membership from publication through activation
/// and until the last retract. Dropping it also unblocks a waiting join on
/// abort, publication failure, or cancellation during an account switch.
pub(crate) type RoomMembership = OwnedMutexGuard<()>;

impl RoomMemberships {
    pub(crate) fn retire(&self, generation: u64) {
        self.retired_through.fetch_max(generation, Ordering::SeqCst);
    }

    pub(super) fn is_retired(&self, generation: u64) -> bool {
        generation <= self.retired_through.load(Ordering::SeqCst)
    }

    pub(super) async fn acquire(&self, generation: u64, room_id: &OwnedRoomId) -> RoomMembership {
        let gate = {
            let mut rooms = self.rooms.lock();
            rooms.retain(|_, gate| gate.strong_count() > 0);
            let entry = rooms.entry((generation, room_id.clone())).or_default();
            entry.upgrade().unwrap_or_else(|| {
                let gate = Arc::new(RoomGate::new(()));
                *entry = Arc::downgrade(&gate);
                gate
            })
        };
        gate.lock_owned().await
    }
}
