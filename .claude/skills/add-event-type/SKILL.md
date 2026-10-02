---
name: add-event-type
description: Add a new persisted event (custom event_type in the append-only log) or a transient UI event, with its producer, readers and tests. Use when the core, harness or a run needs to record or announce something new.
---

# Add an event type

Two kinds exist. Pick one before writing code.

| Kind | Survives restart | Producer | Transport |
|---|---|---|---|
| Persisted | yes; the log is the agent's whole state | core `append`, harness `events.append` | `studio:events` pull |
| Transient UI | no | core `emit`, harness `ctx.notify` / `ui.notify` | `studio:event` push |

If a later session, the chat transcript, Studio activity or a run review must show it, it is
persisted. Progress ticks, status lines and "refresh now" hints are transient.

## Persisted: a custom event

1. Keep `EventData` in `src/shared/event-log.ts` unchanged. New events are
   `{ type: "custom", event_type: "snake_case_name", payload }`. Add a new top-level
   `type` only for a new substrate primitive (and update `normalizeEvent` in
   `src/substrate/event-store.ts`).
2. Contract first, in `src/shared/custom-events.ts`: add a PascalCase key with its exact wire value to `CustomEvent`
   (`CUSTOM_EVENT_TYPES` is derived), and, when the app reads it, its payload to `CustomEventMap` (a map key the registry lacks
   fails the typecheck). Every field is optional: old
   logs and self-edited harness code can emit partial payloads. Reuse a payload type that
   already lives in `src/shared` (`AssetDeliveredPayload`, `PluginToolStartedPayload`, …).
3. Produce it (`NewEvent` below stands for the key you add; use the seed
   `HostMethod` from `src/harness-seed/loop/host-methods.ts` for harness calls):
   - core: `await this.append([customEventData(CustomEvent.NewEvent, payload)], threadId)` in
     `src/main/studio-core.ts` (or the module that owns the behaviour);
   - harness: `await ctx.call(HostMethod.EventsAppend, {batch:[...]})` (typed by `HarnessHostApi` in
     `src/shared/harness-api.ts`), as in
     `src/harness-seed/tools/self-tools.ts`. Harness-seed is shipped product payload: edit it
     as product code, and add an incident row (the `harness-incident-fix` skill).
4. Read it where it shows up: `src/shared/studio-activity.ts` (`STUDIO_RECORD_EVENTS`),
   `src/shared/chat-activity.ts`, `src/shared/run-review.ts`, `src/renderer/chat-entries.ts`,
   `src/renderer/run-graph.ts`, `src/renderer/build-progress.ts`. Read the payload with
   `customEvent(event, CustomEvent.NewEvent)` / `customPayload(data, [CustomEvent.NewEvent])` (`null` for any other event,
   `{}` for a missing payload), `delegatedPayload` for `delegated.<engine>`, or `customRecord`
   for any custom event; no `data.payload as`. Grep `event_type ===` to find every consumer of
   a similar event, and keep the names consistent with them.
5. Never rewrite or delete old events to migrate; readers accept both shapes.

## Transient: a UI event

- Contract first: add the exact wire name and payload to `UiEventMap`, and a PascalCase key
  to `UiEvent` in `src/shared/ui-events.ts`; `UI_EVENT_TYPES` is derived
  (named like `run.finished` or `preview.frame`). Fields the harness writes stay optional:
  it is edited at runtime and main forwards its notifications unchanged.
- Core: `this.emit(UiEvent.NewEvent, payload)`, typed by the map; main's `pushUiEvent` in
  `src/main/index.ts` (also typed) forwards it as `studio:event` (a push channel of
  `src/shared/ipc-channels.ts`).
- Harness: keep the matching wire name in a seed-owned `as const` vocabulary beside its
  producer, then call `ctx.notify(SeedUiEvent.NewEvent, payload)`. The example name stands
  for that vocabulary; there is no shared seed `UiEvent` export. Never import app source
  into the editable seed. Keep the seed/app contract covered by its contract tests.
- Renderer: `window.studio.onEvent(event => { if (event.type === UiEvent.NewEvent) … })` narrows the
  payload; `isUiEventIn(event, "area.")` narrows a family. No `event.payload as`.
- `tests/conformance/ui-events.test.ts` fails when a produced name is missing from the map, or a
  key is no longer produced.
- Nothing may depend on a transient event having been seen; the next pull must be able to
  rebuild the state.

## Tests (red first)

- `tests/conformance/custom-events.test.ts` scans `src` as data and fails when the code writes
  or reads a custom event name missing from `CUSTOM_EVENT_TYPES`, or the registry keeps a name
  nothing uses.

- Reader: feed synthetic `EventEnvelope`s (including an old/partial payload) to the pure
  reader, as `tests/conformance/studio-activity.test.ts` and `chat-history.test.ts` do.
- Producer: drive the behaviour through `tests/helpers/core-lite.ts` and read the log back
  with `core.store.listEvents(threadId)`; for harness producers use `startRig` and
  `customEvents` from `tests/helpers/studio-rig.ts`.
- Log invariants: `tests/conformance/event-store.test.ts` when touching the store itself.

```sh
npm test -- tests/conformance/studio-activity.test.ts tests/conformance/<producer>.test.ts
```
