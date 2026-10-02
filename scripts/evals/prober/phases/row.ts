/**
 * How a full-prober row is built: its layer comes from its id (`l1.`, `l2.`, `l3.`), its title from
 * one table, and a row the substrate cannot answer says so with `gates: false`. The quick rows keep
 * their own builder in `quick-rows.ts`; these are the rows only the full prober (M3) answers.
 */
import { CheckResult, ProbeRow } from "../../vocabulary.ts";
import { type Check, CheckLayer, CheckSource } from "../types.ts";

const LAYER_BY_PREFIX: Record<string, CheckLayer> = { l1: CheckLayer.L1, l2: CheckLayer.L2, l3: CheckLayer.L3 };

/** The full prober's own rows, in the wording a scorecard prints. */
export const FULL_ROW_TITLE: Partial<Record<ProbeRow, string>> = {
  [ProbeRow.L1NoErrors60s]: "No uncaught errors in the first 60 seconds",
  [ProbeRow.L1Survives5min]: "Survives 5 minutes",
  [ProbeRow.L1FrameRateFloor]: "Frame rate above a floor (recorded, never a quality score)",
  [ProbeRow.L2ActionAcknowledged200ms]: "Actions acknowledged within ~200 ms",
  [ProbeRow.L2NoSoftLock5min]: "No soft-lock, content lasts 5 minutes",
  [ProbeRow.L2DirectionsMatchLabels]: "Directions match their labels",
  [ProbeRow.L2InteractAcknowledged]: "An interact verb (F / E / Enter) is acknowledged",
  [ProbeRow.L3DarkPhase]: "Darkest verified playable phase",
  [ProbeRow.L3SpatiallyLegible]: "Spatially legible",
  [ProbeRow.L3AssetsUsable]: "Every asset that arrived could be used",
  [ProbeRow.L3PhoneViewport]: "Works at a phone viewport",
  [ProbeRow.L3AudioNetwork]: "Audio 1/5: did an audio file load",
  [ProbeRow.L3AudioContextState]: "Audio 2/5: AudioContext state",
  [ProbeRow.L3AudioGraphEdges]: "Audio 3/5: is anything connected to the destination",
  [ProbeRow.L3AudioOutputRms]: "Audio 4/5: output RMS from an analyser tapped onto the destination",
  [ProbeRow.L3AudioElementState]: "Audio 5/5: <audio>/<video> element state",
};

/** The layer a row id belongs to. */
export function layerOf(id: ProbeRow): CheckLayer {
  return LAYER_BY_PREFIX[id.slice(0, 2)];
}

/** A machine-answered row; `gates: false` only when this substrate cannot answer it. */
export function machineRow(id: ProbeRow, result: CheckResult, detail: string, value: unknown, gates = true): Check {
  const row: Check = {
    id,
    layer: layerOf(id),
    title: FULL_ROW_TITLE[id] ?? id,
    result,
    source: CheckSource.Machine,
    value,
    detail,
  };
  return gates ? row : { ...row, gates: false };
}

/** A judge-owned row: declared, never guessed, always `unknown` from the machine. */
export function judgeRow(id: ProbeRow, detail: string): Check {
  return {
    id,
    layer: layerOf(id),
    title: FULL_ROW_TITLE[id] ?? id,
    result: CheckResult.Unknown,
    source: CheckSource.Judge,
    value: null,
    detail,
  };
}

/** `pass` when true, `fail` when false. */
export function verdictOf(ok: boolean): CheckResult {
  return ok ? CheckResult.Pass : CheckResult.Fail;
}

/** Apply door demotions in order: each only ever turns a `fail` into `unknown`, and appends its reason. */
export function applyDemotions(
  first: { result: CheckResult; detail: string },
  steps: ReadonlyArray<(result: CheckResult) => { result: CheckResult; why: string | null }>,
): { result: CheckResult; detail: string } {
  let { result, detail } = first;
  for (const step of steps) {
    const moved = step(result);
    if (moved.why === null) continue;
    result = moved.result;
    detail = `${detail} ${moved.why}`;
  }
  return { result, detail };
}
