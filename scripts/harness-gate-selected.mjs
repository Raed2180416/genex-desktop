// Reads `affected-tests.mjs --json` on stdin and exits 0 when the selection holds the harness gate
// (the suites `npm run verify:harness` runs), 1 otherwise. check.yml's gate job runs the harness
// gate only for a change that reaches it.
import { readFileSync } from "node:fs";
import { HARNESS_GATE } from "./affected-tests.mjs";

const selection = JSON.parse(readFileSync(0, "utf8"));
const selected = [...(selection.L1 ?? []), ...(selection.L3 ?? [])];
process.exit(HARNESS_GATE.some((test) => selected.includes(test)) ? 0 : 1);
