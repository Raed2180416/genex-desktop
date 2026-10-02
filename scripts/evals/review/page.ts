/**
 * The review page: an HTML shell, its stylesheet and its script, each served from the review
 * server itself, because the page's policy is `default-src 'self'` (no inline script or style, no
 * CDN, no network beyond this server). The shell carries only the session token, escaped; every
 * task arrives as JSON and is written with `textContent` and `setAttribute`, never as markup. The
 * script never spells a code: the keys, picks, defects and verdicts come from the session's JSON.
 */
import { escapeHtml } from "../report/html/escape.ts";

/** The query parameter every request carries the session token in. */
export const TOKEN_PARAM = "t";
/** The page's paths on the review server. */
export const ReviewPath = {
  Page: "/",
  Script: "/review.js",
  Style: "/review.css",
  Task: "/api/task",
  Answer: "/api/answer",
  MediaPrefix: "/media/",
} as const;
export type ReviewPath = (typeof ReviewPath)[keyof typeof ReviewPath];

/** The policy on every response: this server only, nothing inline, never framed. */
export const REVIEW_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

/** A path on this server with the session token appended. */
export function withToken(pathname: string, token: string): string {
  return `${pathname}?${TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

/** The page shell for one session; the script finds the token on `body[data-token]`. */
export function reviewPageHtml(token: string): string {
  const safe = escapeHtml(token);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Blind review</title>
<link rel="stylesheet" href="${escapeHtml(withToken(ReviewPath.Style, token))}">
</head>
<body data-token="${safe}">
<header><h1>Blind review</h1><p id="progress" aria-live="polite"></p></header>
<main id="task"><p class="note">Loading…</p></main>
<footer><p class="note" id="keys"></p><p class="note" id="status" role="status" aria-live="polite"></p></footer>
<script src="${escapeHtml(withToken(ReviewPath.Script, token))}"></script>
</body>
</html>
`;
}

/** The page's stylesheet: system fonts, light and dark, frames in a two-column strip. */
export const REVIEW_CSS = `
:root { color-scheme: light dark; --bg: #fbfbfa; --fg: #1d1d1b; --muted: #6b6a66; --line: #dcdad4; --accent: #2f5bd3; --chosen: #e7edfb; }
@media (prefers-color-scheme: dark) { :root { --bg: #171716; --fg: #ecebe7; --muted: #a09e97; --line: #3a3936; --accent: #8aa6ff; --chosen: #232b40; } }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1200px; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, -apple-system, sans-serif; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--line); }
h1 { font-size: 18px; margin: 8px 0; }
h2 { font-size: 16px; margin: 16px 0 4px; }
.note { color: var(--muted); margin: 4px 0; }
.brief { white-space: pre-wrap; border-left: 3px solid var(--line); padding: 4px 12px; margin: 8px 0 16px; }
.sides { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.side { border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
.strip { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.strip img, .side video { width: 100%; height: auto; border-radius: 4px; background: #000; display: block; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 16px 0; }
button, select { font: inherit; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
button[aria-pressed="true"] { background: var(--chosen); border-color: var(--accent); }
button.save { border-color: var(--accent); color: var(--accent); }
button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
kbd { font: 12px ui-monospace, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
.verdicts { display: flex; gap: 12px; flex-wrap: wrap; margin: 8px 0; }
.error { color: #c0392b; }
`;

/** The page's script, shipped as text: it reads tasks as JSON and posts one answer per task. */
export const REVIEW_SCRIPT = `
(function () {
  "use strict";
  var token = document.body.getAttribute("data-token") || "";
  var query = "?${TOKEN_PARAM}=" + encodeURIComponent(token);
  var view = null;
  var answer = null;
  function $(id) { return document.getElementById(id); }
  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function status(text, isError) {
    var node = $("status");
    node.textContent = text || "";
    node.className = isError ? "note error" : "note";
  }
  function strip(side) {
    var box = el("div", null, "side");
    box.append(el("h2", side.label));
    if (side.video) {
      var video = el("video");
      video.setAttribute("controls", "");
      video.setAttribute("preload", "metadata");
      video.setAttribute("src", side.video.url);
      box.append(video);
    }
    if (!side.frames.length) box.append(el("p", "No frames were witnessed for this side.", "note"));
    var frames = el("div", null, "strip");
    side.frames.forEach(function (frame, index) {
      var img = el("img");
      img.setAttribute("src", frame.url);
      img.setAttribute("alt", side.label + ", frame " + (index + 1));
      img.setAttribute("loading", "lazy");
      frames.append(img);
    });
    box.append(frames);
    return box;
  }
  function select(label, options, value, onChange) {
    var wrap = el("label", label + " ");
    var node = el("select");
    options.forEach(function (option) {
      var opt = el("option", option.label);
      opt.setAttribute("value", option.value);
      if (option.value === value) opt.selected = true;
      node.append(opt);
    });
    node.addEventListener("change", function () { onChange(node.value); });
    wrap.append(node);
    return wrap;
  }
  function choices(options, current, onPick) {
    var row = el("div", null, "controls");
    options.forEach(function (option) {
      var button = el("button", option.label);
      button.setAttribute("type", "button");
      button.setAttribute("aria-pressed", option.value === current ? "true" : "false");
      button.addEventListener("click", function () { onPick(option.value); });
      row.append(button);
    });
    return row;
  }
  function defectPicker() {
    var options = view.codes.defects.map(function (code) { return { value: code, label: code }; });
    return select("Decisive defect", options, answer.defect, function (value) { answer.defect = value; });
  }
  function saveRow(ready) {
    var row = el("div", null, "controls");
    var save = el("button", "Save and next (Enter)", "save");
    save.setAttribute("type", "button");
    save.disabled = !ready;
    save.addEventListener("click", submit);
    row.append(save);
    return row;
  }
  function caseHeader(host, task) {
    host.append(el("h2", task.caseLabel || "Case"));
    host.append(el("p", task.brief || "The brief for this case version is not available.", "brief"));
  }
  function drawPair(host, task) {
    caseHeader(host, task);
    var sides = el("div", null, "sides");
    task.sides.forEach(function (side) { sides.append(strip(side)); });
    host.append(sides);
    var satisfied = el("div", null, "controls");
    task.sides.forEach(function (side) {
      satisfied.append(select(side.label + " satisfies the request?", view.codes.satisfied, answer.satisfied[side.key], function (value) {
        answer.satisfied[side.key] = value;
      }));
    });
    host.append(satisfied);
    host.append(choices(view.codes.picks, answer.pick, function (value) { answer.pick = value; draw(); }));
    host.append(defectPicker());
    host.append(saveRow(answer.pick !== null));
  }
  function drawItem(host, task) {
    caseHeader(host, task);
    host.append(el("h2", (task.itemKey ? "Key item: " : "Item: ") + task.itemText));
    var verdicts = el("div", null, "verdicts");
    task.verdicts.forEach(function (v) { verdicts.append(el("span", v.family + " graders: " + v.verdict)); });
    verdicts.append(el("span", "combined: " + task.combined));
    host.append(verdicts);
    host.append(strip(task.side));
    host.append(choices(view.codes.verdicts, answer.human, function (value) { answer.human = value; draw(); }));
    host.append(defectPicker());
    host.append(saveRow(answer.human !== null));
  }
  function draw() {
    var host = $("task");
    host.replaceChildren();
    var p = view.progress;
    $("progress").textContent = p.done + " of " + p.total + " done";
    $("keys").textContent = view.codes.keyHelp;
    if (!view.task) {
      host.append(el("p", "All done. You can close this tab; the review session in the terminal ends by itself."));
      return;
    }
    if (view.task.mode === view.codes.modes.pair) drawPair(host, view.task);
    else drawItem(host, view.task);
  }
  function fresh() {
    var none = view.codes.defaultDefect;
    var unsure = view.codes.defaultSatisfied;
    answer = { taskId: view.task ? view.task.taskId : null, pick: null, human: null, defect: none, satisfied: { a: unsure, b: unsure } };
  }
  function load() {
    fetch("${ReviewPath.Task}" + query, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (data) { view = data; fresh(); draw(); status(""); })
      .catch(function (e) { status("Could not load the next task (" + e.message + ").", true); });
  }
  function submit() {
    if (!view || !view.task) return;
    var ready = view.task.mode === view.codes.modes.pair ? answer.pick !== null : answer.human !== null;
    if (!ready) return;
    status("Saving…");
    fetch("${ReviewPath.Answer}" + query, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(answer) })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (reply) { if (!reply.ok) throw new Error(reply.body.error || "refused"); load(); })
      .catch(function (e) { status("Not saved: " + e.message, true); });
  }
  document.addEventListener("keydown", function (event) {
    if (!view || !view.task || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target && event.target.tagName === "SELECT") return;
    if (event.key === "Enter") { event.preventDefault(); submit(); return; }
    var keys = view.task.mode === view.codes.modes.pair ? view.codes.pickKeys : view.codes.verdictKeys;
    var value = keys[event.key.toLowerCase()];
    if (value === undefined) return;
    if (view.task.mode === view.codes.modes.pair) answer.pick = value; else answer.human = value;
    draw();
  });
  load();
})();
`;
