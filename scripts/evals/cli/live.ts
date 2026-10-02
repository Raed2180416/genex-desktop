/**
 * The `--live` gate (Rule 11, §13.6). A command that spends provider quota or sends rows off the
 * machine runs only when the operator types `--live`, and never in CI, whatever it is given.
 * `campaign run` is the one command where `--live` is its own switch: without it the handler lists
 * what would run. The gate reads the command line only; it never starts, reads or sends anything.
 */

/** The flag that opts a command into live work. */
export const LIVE_FLAG = "--live";

/** How a command line uses `--live`. */
export const LiveNeed = {
  /** Local only: `--live` is not a flag of this command. */
  None: "none",
  /** Spends quota or sends data: refused without `--live`, which the gate then removes. */
  Required: "required",
  /** `--live` is the handler's own switch (a dry run without it); the gate passes it through. */
  Switch: "switch",
} as const;
export type LiveNeed = (typeof LiveNeed)[keyof typeof LiveNeed];

/** Why the gate refused a command line. */
export const LiveRefusal = {
  /** The command spends quota or sends data and `--live` was not given. */
  Required: "live-required",
  /** `--live` was given where CI runs: live evals never run in CI. */
  InCi: "live-in-ci",
} as const;
export type LiveRefusal = (typeof LiveRefusal)[keyof typeof LiveRefusal];

/** The variables a CI runner sets; any of them set to a true value means CI. */
const CI_VARIABLES = ["CI", "GITHUB_ACTIONS"] as const;
const TRUE_VALUES: ReadonlySet<string> = new Set(["1", "true"]);

/** Whether `env` is a CI runner's. */
export function runsInCi(env: Readonly<Record<string, string | undefined>>): boolean {
  return CI_VARIABLES.some((name) => TRUE_VALUES.has((env[name] ?? "").toLowerCase()));
}

/** The gate's answer: the arguments the handler gets, or why nothing runs. */
export type LiveGate = { refusal: null; args: string[] } | { refusal: LiveRefusal; args: null };

/** Apply the gate to one command line. */
export function liveGate(
  need: LiveNeed,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): LiveGate {
  const live = args.includes(LIVE_FLAG);
  if (need === LiveNeed.None) return { refusal: null, args: [...args] };
  if (need === LiveNeed.Required && !live) return { refusal: LiveRefusal.Required, args: null };
  if (live && runsInCi(env)) return { refusal: LiveRefusal.InCi, args: null };
  const handed = need === LiveNeed.Switch ? [...args] : args.filter((arg) => arg !== LIVE_FLAG);
  return { refusal: null, args: handed };
}
