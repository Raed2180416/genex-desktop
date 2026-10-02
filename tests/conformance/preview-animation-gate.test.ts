import assert from "node:assert/strict";
import test from "node:test";
import { animationGate } from "../../src/page/animation-gate.ts";

test("hidden previews retain callbacks without any native RAF and resume each once", () => {
  const native = new Map<number, (time: number) => void>();
  let id = 0;
  const gate = animationGate({
    request: (callback) => {
      native.set(++id, callback);
      return id;
    },
    cancel: (key) => {
      native.delete(key);
    },
  });
  const calls: number[] = [];
  gate.request((time) => calls.push(time));
  gate.setVisible(false);
  gate.setVisible(false);
  assert.equal(native.size, 0);
  gate.request((time) => calls.push(time + 1));
  const cancelled = gate.request(() => assert.fail("cancelled callback ran"));
  gate.cancel(cancelled);
  assert.equal(native.size, 0);
  gate.setVisible(true);
  gate.setVisible(true);
  assert.equal(native.size, 2);
  const jobs = [...native.values()];
  native.clear();
  for (const callback of jobs) callback(100);
  assert.deepEqual(calls, [100, 101]);
  gate.setVisible(false);
  gate.setVisible(true);
  assert.equal(native.size, 0);
});

test("a frame callback can hide and queue its next frame without restarting the pump", () => {
  const native = new Map<number, (time: number) => void>();
  let id = 0;
  const gate = animationGate({
    request: (callback) => {
      native.set(++id, callback);
      return id;
    },
    cancel: (key) => {
      native.delete(key);
    },
  });
  let frames = 0;
  const pump = () => {
    frames++;
    gate.setVisible(false);
    gate.request(pump);
  };
  gate.request(pump);
  const first = [...native.values()];
  native.clear();
  first[0]?.(1);
  assert.equal(frames, 1);
  assert.equal(native.size, 0);
  gate.setVisible(true);
  const second = [...native.values()];
  native.clear();
  second[0]?.(2);
  assert.equal(frames, 2);
  assert.equal(native.size, 0);
});

test("a native callback already queued before hide cannot escape the visibility gate", () => {
  let deliver: ((time: number) => void) | undefined;
  const gate = animationGate({
    request: (callback) => {
      deliver = callback;
      return 1;
    },
    cancel: () => {},
  });
  let frames = 0;
  gate.request(() => {
    frames++;
  });
  gate.setVisible(false);
  deliver?.(1);
  assert.equal(frames, 0);
  gate.setVisible(true);
  deliver?.(2);
  assert.equal(frames, 1);
});

test("a cancelled callback from before hide cannot consume the newly armed frame after show", () => {
  const deliveries: Array<(time: number) => void> = [];
  const gate = animationGate({
    request: (callback) => {
      deliveries.push(callback);
      return deliveries.length;
    },
    cancel: () => {},
  });
  const frames: number[] = [];
  gate.request((time) => frames.push(time));
  gate.setVisible(false);
  gate.setVisible(true);
  deliveries[0]?.(1);
  assert.deepEqual(frames, []);
  deliveries[1]?.(2);
  assert.deepEqual(frames, [2]);
});
