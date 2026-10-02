/**
 * Main's IPC, one registrar per domain. Every registrar registers through the same typed
 * `handle(channel, fn)` from `../ipc-handle.ts` — channel, payload and result come from the map
 * in `shared/ipc-channels.ts` — and takes what it needs as explicit dependencies, so the app
 * lifecycle in `../index.ts` owns the mutable state and a registrar owns none of it.
 */
import type { createIpcHandle } from "../ipc-handle.ts";

/** The typed `handle(channel, fn)` main registers every channel through. */
export type IpcHandle = ReturnType<typeof createIpcHandle>;
