---
kind: upgrade-guide
description: "Trusted task-service implementations and complete settings objects gain task observation methods and an observer limit."
---
# Upgrade task observation

## Change

The task service adds subscribe, wait and join. Implementations and mocks typed as JobDeliveryService must provide these methods. Schema-resolved settings gain maxObservers with a default of 256; manually written complete Settings objects must supply this value. Existing saved configuration remains valid.

The task storage schema remains 1. Existing records, payloads and outputs retain their fields and location; there is no migration or automatic replay.

## Migration

1. Update typed service implementations and mocks for JobDeliveryService.subscribe, wait and join. wait observes one task until its native workers and outputs settle; cancelling the wait does not cancel that task. Call cancel and then join when owning cancellation and resource cleanup.
2. Resolve settings through Config, or add maxObservers to complete settings objects. A subscription occupies one slot until its disposer runs; wait also owns one temporary slot.
3. Upgrade the bundle and reload the browser or desktop client. Check the owner page exposes the observer limit and preserves existing tasks. Run the focused task-observation tests when updating a consumer.
