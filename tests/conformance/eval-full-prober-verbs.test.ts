/**
 * One verb, measured (`measureVerb`), and the two rows it feeds: `l2.action_acknowledged_200ms`
 * (which cannot gate when the sampler is too coarse for a 200 ms target, or on a software rasteriser)
 * and `l2.interact_acknowledged` (pass or unknown, never fail, never gating). Replayed against a fake
 * sampler: no browser.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProbeRms, ProbeSample } from "../../scripts/evals/prober/instrument.ts";
import { ackRow, SPEC_ACK_MS, verbPhase } from "../../scripts/evals/prober/phases/ack.ts";
import { BaselineName, buildBaseline } from "../../scripts/evals/prober/phases/baseline.ts";
import { interactRow } from "../../scripts/evals/prober/phases/interact.ts";
import {
  ACK_WINDOW_MS,
  AUDIBLE_RMS,
  measureVerb,
  type VerbAcknowledgement,
  type VerbDeps,
} from "../../scripts/evals/prober/phases/verbs.ts";
import { gateFor } from "../../scripts/evals/prober/verdicts.ts";
import { CheckResult, ProbeRow, RendererMode } from "../../scripts/evals/vocabulary.ts";

const STILL = buildBaseline(BaselineName.PostEntrance, [0.001, 0.001, 0.001, 0.001, 0.001, 0.001]);

/**
 * A page on a virtual clock: sampled every `everyMs`, with ambient motion `ambient` and, when the verb
 * lands, a response of `response` after `latencyMs` (and audio when `audible`).
 */
function fakeSampler(opts: {
  everyMs: number;
  ambient: number;
  response: number;
  latencyMs: number;
  audible?: boolean;
}) {
  let now = 10_000;
  let verbAt: number | null = null;
  const samples: ProbeSample[] = [];
  const rms: ProbeRms[] = [];
  const advance = (ms: number) => {
    const end = now + ms;
    while (now + opts.everyMs <= end) {
      now += opts.everyMs;
      const responding = verbAt !== null && now >= verbAt + opts.latencyMs && now <= verbAt + opts.latencyMs + 300;
      samples.push({ t: now, m: 0.4, d: responding ? opts.response : opts.ambient });
      rms.push({ t: now, c: 1, rms: responding && opts.audible ? AUDIBLE_RMS * 10 : 0, peak: 0 });
    }
    now = end;
  };
  const deps: VerbDeps = {
    sleep: async (ms) => advance(ms),
    pullSeries: async () => {},
    samples: () => samples,
    rms: () => rms,
    mark: async () => {
      verbAt = now;
      return now;
    },
    capture: async () => null,
    baseline: () => STILL,
    log: () => {},
    ackWindowMs: ACK_WINDOW_MS,
  };
  return { deps, samples };
}

const sent = async () => ({ sent: true, reason: null });

describe("measureVerb", () => {
  it("reads the first response above the threshold and beats the matched control window", async () => {
    const page = fakeSampler({ everyMs: 16, ambient: 0.001, response: 0.05, latencyMs: 100 });
    const v = await measureVerb(page.deps, "Space", sent);
    assert.equal(v.sent, true);
    assert.ok(v.pixelLatencyMs !== null && v.pixelLatencyMs >= 100 && v.pixelLatencyMs < 120);
    assert.equal(v.pixelExceededControl, true);
    assert.equal(v.baseline, BaselineName.PostEntrance);
  });

  it("AMBIENT: a response that does not beat the pre-verb control max is not an acknowledgement", async () => {
    const page = fakeSampler({ everyMs: 16, ambient: 0.06, response: 0.05, latencyMs: 100 });
    const v = await measureVerb(page.deps, "KeyF", sent);
    assert.ok(v.pixelLatencyMs !== null, "the threshold alone is cleared by ambient motion");
    assert.equal(v.pixelExceededControl, false);
  });

  it("a REFUSED verb reads no window: nothing ambient is credited to a verb that never went out", async () => {
    const page = fakeSampler({ everyMs: 16, ambient: 0.06, response: 0.05, latencyMs: 0 });
    const v = await measureVerb(page.deps, "Space", async () => ({ sent: false, reason: "focus on a link" }));
    assert.equal(v.sent, false);
    assert.equal(v.refusedWhy, "focus on a link");
    assert.equal(v.pixelLatencyMs, null);
    assert.equal(v.pixelExceededControl, null);
  });
});

function verb(overrides: Partial<VerbAcknowledgement>): VerbAcknowledgement {
  return {
    verb: "Space",
    sent: true,
    refusedWhy: null,
    pixelLatencyMs: null,
    audioLatencyMs: null,
    pixelDelta: null,
    audioDelta: null,
    pixelControlMax: 0.001,
    pixelControlSamples: 10,
    pixelExceededControl: null,
    baseline: BaselineName.PostEntrance,
    changeThreshold: 0.004,
    ...overrides,
  };
}

const fineSamples: ProbeSample[] = Array.from({ length: 50 }, (_, i) => ({ t: i * 16, m: 0.4, d: 0.001 }));
const coarseSamples: ProbeSample[] = Array.from({ length: 50 }, (_, i) => ({ t: i * 900, m: 0.4, d: 0.001 }));

describe("l2.action_acknowledged_200ms", () => {
  it("passes within the target on a GPU renderer and gates", () => {
    const row = ackRow({
      verbs: [verb({ pixelLatencyMs: 80 })],
      samples: fineSamples,
      rendererMode: RendererMode.Gpu,
      ackWindowMs: ACK_WINDOW_MS,
    });
    assert.equal(row.id, ProbeRow.L2ActionAcknowledged200ms);
    assert.equal(row.result, CheckResult.Pass);
    assert.notEqual(row.gates, false);
  });

  it("a late response at fine resolution fails", () => {
    const row = ackRow({
      verbs: [verb({ pixelLatencyMs: SPEC_ACK_MS * 3 })],
      samples: fineSamples,
      rendererMode: RendererMode.Gpu,
      ackWindowMs: ACK_WINDOW_MS,
    });
    assert.equal(row.result, CheckResult.Fail);
  });

  it("TOO COARSE: a sampler slower than half the target cannot tell late from sampled late, so gates: false", () => {
    const row = ackRow({
      verbs: [verb({ pixelLatencyMs: 900 })],
      samples: coarseSamples,
      rendererMode: RendererMode.Gpu,
      ackWindowMs: ACK_WINDOW_MS,
    });
    assert.equal(row.result, CheckResult.Unknown);
    assert.equal(row.gates, false);
    assert.equal(gateFor([row]).l2, CheckResult.Unknown, "an L2 made only of it cannot read pass or fail");
  });

  it("SOFTWARE RASTERISER: the row never gates, even when it could answer", () => {
    const row = ackRow({
      verbs: [verb({ pixelLatencyMs: 900 })],
      samples: fineSamples,
      rendererMode: RendererMode.Software,
      ackWindowMs: ACK_WINDOW_MS,
    });
    assert.equal(row.result, CheckResult.Fail);
    assert.equal(row.gates, false);
  });

  it("no response is unknown, never a fail, and a refused verb is named as refused", () => {
    const row = ackRow({
      verbs: [verb({}), verb({ verb: "MouseLeft", sent: false, refusedWhy: "a link under the point" })],
      samples: fineSamples,
      rendererMode: RendererMode.Gpu,
      ackWindowMs: ACK_WINDOW_MS,
    });
    assert.equal(row.result, CheckResult.Unknown);
    assert.match(row.detail, /MouseLeft was NOT sent/);
  });

  it("verbPhase measures each verb in order", async () => {
    const page = fakeSampler({ everyMs: 16, ambient: 0.001, response: 0.05, latencyMs: 50 });
    const measured = await verbPhase(page.deps, [
      { verb: "Space", send: sent },
      { verb: "MouseLeft", send: sent },
    ]);
    assert.deepEqual(
      measured.map((v) => v.verb),
      ["Space", "MouseLeft"],
    );
  });
});

describe("l2.interact_acknowledged", () => {
  it("passes on audio, or on pixels that beat the control window; never gates", () => {
    const row = interactRow([verb({ verb: "KeyF", audioLatencyMs: 40 })], ACK_WINDOW_MS);
    assert.equal(row.result, CheckResult.Pass);
    assert.equal(row.gates, false);
  });

  it("NEVER FAILS: ambient-only pixels and silence are unknown, naming why", () => {
    const row = interactRow(
      [
        verb({
          verb: "KeyF",
          pixelLatencyMs: 60,
          pixelDelta: 0.05,
          pixelControlMax: 0.07,
          pixelExceededControl: false,
        }),
        verb({ verb: "KeyE" }),
        verb({ verb: "Enter", sent: false, refusedWhy: "focus on a button" }),
      ],
      ACK_WINDOW_MS,
    );
    assert.equal(row.result, CheckResult.Unknown);
    assert.equal(row.gates, false);
    assert.match(row.detail, /ambient motion/);
    assert.match(row.detail, /Enter was NOT sent/);
  });
});
