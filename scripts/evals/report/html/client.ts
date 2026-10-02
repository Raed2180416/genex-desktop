/**
 * The explorer's in-page script, shipped as text inside the static page (no dependencies, no
 * network). It reads the embedded data block, fills the filters, and draws the runs table, the
 * per-campaign scorecard visibility and a trend per metric over app builds. It writes data only
 * through `textContent` and `setAttribute` (never markup), prints a missing value as "not measured"
 * and never plots it: a trend point exists only where a run measured the metric.
 */
export const EXPLORER_SCRIPT = `
(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("ledger-data").textContent);
  var SVG = "http://www.w3.org/2000/svg";
  var units = {};
  data.metrics.forEach(function (m) { units[m.id] = m.unit; });
  function $(id) { return document.getElementById(id); }
  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function svg(tag, attrs) {
    var node = document.createElementNS(SVG, tag);
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, String(attrs[k])); });
    return node;
  }
  function minutes(ms) {
    var m = ms / 60000;
    var r = Math.round(m);
    return r === 0 && m > 0 ? "<1 min" : r + " min";
  }
  function format(id, value) {
    if (value === null || value === undefined) return null;
    var unit = units[id];
    if (unit === "ms") return minutes(value);
    if (unit === "usd") return "$" + value.toFixed(2) + " est.";
    if (unit === "percent") return Math.round(value) + "%";
    if (unit === "fraction") return Math.round(value * 100) + "%";
    return Math.round(value).toLocaleString("en-US");
  }
  function valueCell(id, value) {
    var text = format(id, value);
    return text === null ? el("td", "not measured", "missing") : el("td", text);
  }
  function median(values) {
    if (values.length === 0) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = (s.length - 1) / 2;
    return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
  }
  function unique(key) {
    var seen = {};
    data.runs.forEach(function (r) { seen[r[key]] = true; });
    return Object.keys(seen).sort();
  }
  function fill(select, values, all) {
    select.replaceChildren();
    var first = el("option", all);
    first.value = "";
    select.append(first);
    values.forEach(function (v) {
      var o = el("option", v);
      o.value = v;
      select.append(o);
    });
  }
  var f = {
    campaign: $("f-campaign"), caseId: $("f-case"), laneId: $("f-lane"),
    kind: $("f-kind"), metric: $("f-metric"), excluded: $("f-excluded")
  };
  fill(f.campaign, unique("campaignId"), "all campaigns");
  fill(f.caseId, unique("caseId"), "all cases");
  fill(f.laneId, unique("laneId"), "all lanes");
  fill(f.kind, unique("kind"), "all kinds");
  data.metrics.forEach(function (m) {
    if (!m.trend) return;
    var o = el("option", m.id);
    o.value = m.id;
    f.metric.append(o);
  });
  if (data.defaultCampaign) f.campaign.value = data.defaultCampaign;

  function excluded(r) { return r.harnessFailure !== null || r.campaignVoid !== null; }
  function matches(r, withCampaign) {
    if (withCampaign && f.campaign.value && r.campaignId !== f.campaign.value) return false;
    if (f.caseId.value && r.caseId !== f.caseId.value) return false;
    if (f.laneId.value && r.laneId !== f.laneId.value) return false;
    if (f.kind.value && r.kind !== f.kind.value) return false;
    return f.excluded.checked || !excluded(r);
  }
  function statusCell(r) {
    if (r.harnessFailure !== null) return el("td", "harness failure: " + r.harnessFailure + " (excluded from n)", "fail");
    if (r.campaignVoid !== null) return el("td", "campaign void: " + r.campaignVoid, "fail");
    if (r.noBuild !== null) return el("td", "no build: " + r.noBuild, "fail");
    var rail = r.endedHow === data.codes.agentFinished ? "agent finished" : "stopped: " + r.endedHow;
    return el("td", rail);
  }
  function drawRuns() {
    var rows = data.runs.filter(function (r) { return matches(r, true); });
    var body = $("runs-body");
    body.replaceChildren();
    rows.forEach(function (r) {
      var tr = el("tr");
      [r.runId, r.campaignId, r.caseId, r.laneId, r.kind].forEach(function (t) { tr.append(el("td", t)); });
      tr.append(statusCell(r));
      data.columns.forEach(function (id) { tr.append(valueCell(id, r.metrics[id])); });
      body.append(tr);
    });
    $("run-count").textContent = rows.length + " of " + data.runs.length + " rows shown";
  }
  function drawScorecards() {
    var chosen = f.campaign.value || data.defaultCampaign || "";
    document.querySelectorAll("section[data-campaign]").forEach(function (s) {
      s.hidden = s.getAttribute("data-campaign") !== chosen;
    });
  }
  function builds(rows) {
    var order = [];
    rows.slice().sort(function (a, b) { return a.recordedAt < b.recordedAt ? -1 : 1; }).forEach(function (r) {
      if (r.appSha !== null && order.indexOf(r.appSha) < 0) order.push(r.appSha);
    });
    return order;
  }
  function chart(points) {
    var measured = points.filter(function (p) { return p.median !== null; });
    var root = svg("svg", { viewBox: "0 0 300 120", role: "img" });
    root.append(svg("line", { x1: 10, y1: 110, x2: 290, y2: 110, "class": "axis" }));
    if (measured.length === 0) return root;
    var values = measured.map(function (p) { return p.median; });
    var lo = Math.min.apply(null, values);
    var hi = Math.max.apply(null, values);
    var x = function (i) { return points.length === 1 ? 150 : 10 + (280 * i) / (points.length - 1); };
    var y = function (v) { return hi === lo ? 60 : 100 - (90 * (v - lo)) / (hi - lo); };
    var segment = [];
    points.forEach(function (p, i) {
      if (p.median === null) {
        if (segment.length > 1) root.append(svg("polyline", { points: segment.join(" "), "class": "path" }));
        segment = [];
        return;
      }
      segment.push(x(i) + "," + y(p.median));
      var dot = svg("circle", { cx: x(i), cy: y(p.median), r: 3.5, "class": "dot" });
      dot.append(svg("title", {}));
      dot.lastChild.textContent = p.sha.slice(0, 8) + ": " + format(f.metric.value, p.median);
      root.append(dot);
    });
    if (segment.length > 1) root.append(svg("polyline", { points: segment.join(" "), "class": "path" }));
    return root;
  }
  function drawTrend() {
    var metric = f.metric.value;
    var host = $("trend");
    host.replaceChildren();
    var rows = data.runs.filter(function (r) { return matches(r, false) && !excluded(r) && r.kind === data.codes.build; });
    var slices = {};
    rows.forEach(function (r) {
      var key = r.laneId + " · " + r.caseId;
      (slices[key] = slices[key] || []).push(r);
    });
    Object.keys(slices).sort().forEach(function (key) {
      var slice = slices[key];
      var points = builds(slice).map(function (sha) {
        var build = slice.filter(function (r) { return r.appSha === sha; });
        var vals = build.map(function (r) { return r.metrics[metric]; }).filter(function (v) { return v !== null && v !== undefined; });
        return { sha: sha, median: median(vals), measured: vals.length, missing: build.length - vals.length };
      });
      var fig = el("figure");
      fig.append(el("figcaption", key + " — " + metric + " over app builds"));
      fig.append(chart(points));
      var list = el("ul");
      points.forEach(function (p) {
        var text = p.median === null
          ? p.sha.slice(0, 8) + ": not measured (" + p.missing + " runs)"
          : p.sha.slice(0, 8) + ": median " + format(metric, p.median) + " (" + p.measured + " measured, " + p.missing + " not measured)";
        list.append(el("li", text, p.median === null ? "missing" : ""));
      });
      var unplaced = slice.filter(function (r) { return r.appSha === null; }).length;
      if (unplaced > 0) list.append(el("li", unplaced + " runs have no app build pin and are not placed", "missing"));
      fig.append(list);
      host.append(fig);
    });
    if (!host.firstChild) host.append(el("p", "No runs match these filters.", "note"));
  }
  function draw() { drawRuns(); drawScorecards(); drawTrend(); }
  Object.keys(f).forEach(function (k) { f[k].addEventListener("change", draw); });
  draw();
})();
`;
