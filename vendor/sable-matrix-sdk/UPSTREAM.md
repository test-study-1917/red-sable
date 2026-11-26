The two crates in this directory come from
[SableClient/matrix-rust-sdk at 7614a19](https://git.sable.moe/SableClient/matrix-rust-sdk/src/commit/7614a19dd8fcde9355815d2d00be07c8777c6d57)
(Apache-2.0). The root Cargo patch selects them for all SDK consumers, including
WASM. Their sibling crates still come from that same pinned revision.

The sliding-sync client records when the typed HTTP response arrives. The base
crate uses that timestamp for explicit sticky TTLs (stable and MSC4354 field
names), preserves per-event leases beyond visible expiry, and exposes an atomic
room snapshot and a change subscription for call rosters. Keep the two crates
and the upstream revision in sync. Remove the local overrides once the upstream
SDK provides equivalent receipt and reconciliation behavior.

Run the cross-crate regressions from the Red Sable repository root:

    cargo test --locked -p sable-core --lib -- sticky_ttl_primary_acceptance
