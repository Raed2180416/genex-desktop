/**
 * The window's startup loader (index.html's #app-loader): the Genex G, covering the window until
 * the first real screen is drawn, never longer, and leaving the page once, whatever that screen is.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APP_LOADER_ID, dismissAppLoader, firstScreenReady } from "../../src/renderer/app-loader.ts";
import { SessionStatus } from "../../src/renderer/state/session.ts";

/** A stand-in for the loader's element: its data attributes, its listeners and whether it left. */
function fakeLoader() {
  const listeners = new Map<string, () => void>();
  const element = {
    dataset: {} as Record<string, string>,
    removed: 0,
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, listener);
    },
    remove() {
      element.removed += 1;
    },
  };
  const page = { getElementById: (id: string) => (id === APP_LOADER_ID ? element : null) };
  return {
    element,
    page: page as unknown as Pick<Document, "getElementById">,
    fire: (type: string) => listeners.get(type)?.(),
  };
}

describe("startup loader", () => {
  it("waits for the bootstrap, then for the open chat's first page", () => {
    const loading = { status: SessionStatus.Loading, welcoming: false, chatPending: false };
    assert.equal(firstScreenReady(loading), false, "nothing is drawn yet");
    assert.equal(firstScreenReady({ ...loading, status: SessionStatus.Ready, chatPending: true }), false);
    assert.equal(firstScreenReady({ ...loading, status: SessionStatus.Ready }), true);
  });

  it("gives way to the welcome and to a failure without waiting for a chat", () => {
    const pending = { welcoming: false, chatPending: true };
    assert.equal(firstScreenReady({ ...pending, status: SessionStatus.Ready, welcoming: true }), true);
    assert.equal(
      firstScreenReady({ ...pending, status: SessionStatus.Failed }),
      true,
      "the failure and its Retry show",
    );
  });

  it("fades, then leaves the page when the fade ends", () => {
    const { element, page, fire } = fakeLoader();
    dismissAppLoader(page, () => {});
    assert.ok("leaving" in element.dataset, "theme.css fades a leaving loader");
    assert.equal(element.removed, 0, "still there while it fades");
    fire("transitionend");
    assert.equal(element.removed, 1);
  });

  it("leaves even when no fade runs, as under reduced motion", () => {
    const { element, page } = fakeLoader();
    const timers: Array<() => void> = [];
    dismissAppLoader(page, (run) => timers.push(run));
    assert.equal(timers.length, 1);
    timers[0]?.();
    assert.equal(element.removed, 1);
  });

  it("dismisses once, and a page without it is left alone", () => {
    const { element, page } = fakeLoader();
    const timers: Array<() => void> = [];
    dismissAppLoader(page, (run) => timers.push(run));
    dismissAppLoader(page, (run) => timers.push(run));
    assert.equal(timers.length, 1, "a second screen does not start a second fade");
    assert.doesNotThrow(() => dismissAppLoader({ getElementById: () => null }, () => {}));
    assert.equal(element.removed, 0);
  });
});
