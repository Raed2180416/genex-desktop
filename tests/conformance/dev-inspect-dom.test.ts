/**
 * The developer control's page-side inspector runs as source inside the studio window, so every
 * helper it calls must travel with it. These run the script it sends in a bare VM context with a
 * small fake DOM: a missing helper is a ReferenceError here, not a broken `studio:dev` session.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { inspectScript } from "../../src/main/dev/inspect-dom.ts";

interface FakeOptions {
  tag?: string;
  text?: string;
  attrs?: Record<string, string>;
  box?: { left: number; top: number; width: number; height: number };
  children?: FakeElement[];
}

class FakeElement {
  tagName: string;
  textContent: string;
  attrs: Record<string, string>;
  box: { left: number; top: number; width: number; height: number };
  children: FakeElement[];
  parentElement: FakeElement | null = null;
  dataset: Record<string, string> = {};
  disabled = false;
  value = "";
  focused = false;
  constructor(options: FakeOptions = {}) {
    this.tagName = options.tag ?? "DIV";
    this.textContent = options.text ?? "";
    this.attrs = options.attrs ?? {};
    this.box = options.box ?? { left: 0, top: 0, width: 100, height: 20 };
    this.children = options.children ?? [];
    for (const child of this.children) child.parentElement = this;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  getBoundingClientRect() {
    return { ...this.box, right: this.box.left + this.box.width, bottom: this.box.top + this.box.height };
  }
  getClientRects() {
    return this.box.width > 0 ? [this.box] : [];
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  hasAttribute(name: string) {
    return name in this.attrs;
  }
  matches(selector: string) {
    return selectorMatches(this, selector);
  }
  contains(other: FakeElement): boolean {
    return other === this || this.children.some((child) => child.contains(other));
  }
  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  querySelectorAll(selector: string) {
    if (selector.includes("[[")) throw new SyntaxError("bad selector");
    return this.descendants().filter((e) => selectorMatches(e, selector));
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  focus() {
    this.focused = true;
  }
}

/** Enough of CSS selectors for these rows: a comma list of `tag` or `[attr]` or `#id`. */
function selectorMatches(e: FakeElement, selector: string): boolean {
  return selector.split(",").some((part) => {
    const one = part.trim();
    if (one.startsWith("[")) return e.hasAttribute(one.slice(1, one.indexOf("]")).split("=")[0] ?? "");
    if (one.startsWith("#")) return e.attrs.id === one.slice(1);
    return e.tagName.toLowerCase() === one.toLowerCase();
  });
}

function run(body: FakeElement, params: Parameters<typeof inspectScript>[0]) {
  const document = {
    body,
    activeElement: body,
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    querySelector: (selector: string) => body.querySelector(selector),
    elementFromPoint: (x: number, y: number) =>
      body
        .descendants()
        .reverse()
        .find((e) => {
          const r = e.box;
          return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
        }) ?? body,
  };
  const context = vm.createContext({
    window: { __studioPerformance: { RunGraph: { commits: 2, durationMs: 4 } } },
    document,
    innerWidth: 1000,
    innerHeight: 800,
    getComputedStyle: () => ({ visibility: "visible", display: "block", cursor: "default", fontSize: "13px" }),
    matchMedia: () => ({ matches: false }),
  });
  // executeJavaScript hands back a copy; so does this, out of the VM's realm.
  return JSON.parse(JSON.stringify(vm.runInContext(inspectScript(params), context)));
}

describe("developer control page inspector", () => {
  it("locates the one visible element a selector names, at its centre", () => {
    const button = new FakeElement({
      tag: "BUTTON",
      attrs: { id: "go" },
      box: { left: 10, top: 20, width: 40, height: 10 },
    });
    const found = run(new FakeElement({ tag: "BODY", children: [button] }), { selector: "#go", focus: true });
    assert.equal(found.x, 30);
    assert.equal(found.y, 25);
    assert.equal(found.tag, "BUTTON");
    assert.equal(button.focused, true);
  });

  it("reports an unparsable, ambiguous, missing or covered target by its code", () => {
    const a = new FakeElement({ tag: "BUTTON", box: { left: 0, top: 0, width: 10, height: 10 } });
    const b = new FakeElement({ tag: "BUTTON", box: { left: 20, top: 0, width: 10, height: 10 } });
    const body = new FakeElement({ tag: "BODY", children: [a, b] });
    assert.deepEqual(run(body, { selector: "[[" }), { error: "invalid-selector" });
    assert.deepEqual(run(body, { selector: "button" }), { error: "ambiguous-selector" });
    assert.deepEqual(run(body, { selector: "input" }), { error: "target-not-visible" });
    assert.deepEqual(run(body, { scope: "[[" }), { error: "invalid-selector" });
    b.disabled = true;
    assert.deepEqual(run(new FakeElement({ tag: "BODY", children: [b] }), { selector: "button" }), {
      error: "target-not-visible",
    });
  });

  it("snapshots a scope's text, controls and chat rows", () => {
    const status = new FakeElement({ tag: "DIV", attrs: { "data-chat-status": "" } });
    const control = new FakeElement({ tag: "BUTTON", text: "Send", attrs: { "aria-label": "Send message" } });
    const body = new FakeElement({ tag: "BODY", text: "hello", children: [status, control] });
    const snapshot = run(body, { snapshot: true, limit: 5 });
    assert.equal(snapshot.text, "hello");
    assert.equal(snapshot.performance.RunGraph.commits, 2);
    assert.equal(snapshot.textTruncated, false);
    assert.equal(snapshot.chat, null);
    assert.equal(snapshot.plan, null);
    assert.deepEqual(
      snapshot.chatLayout.map((row: { kind: string }) => row.kind),
      ["status"],
    );
    assert.deepEqual(
      snapshot.controls.map((c: { label: string | null }) => c.label),
      ["Send message"],
    );
    assert.equal(snapshot.omitted, 0);
  });
});
