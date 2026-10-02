/**
 * The eval CLI's shared shapes: what a handler is, what it prints through, and the exit codes every
 * command answers with. `check` answers `CHECK_EXIT_CODE` for its verdicts and `campaign run` its
 * own `CAMPAIGN_EXIT`; everything else uses these four.
 */

/** A command's printer: one line at a time. */
export type Out = (line: string) => void;

/** A handler bound to its dependencies: the command's arguments in, its exit code out. */
export type CommandHandler = (args: readonly string[]) => Promise<number>;

/** A registry handler: the arguments and the printer in, the exit code out. */
export type CliRun = (args: readonly string[], out: Out) => Promise<number>;

/** The exit codes the eval commands share. */
export const CliExit = {
  Ok: 0,
  /** Refused its input, stopped on a failure, or found something red (a calibration, a diagnostic). */
  Refused: 1,
  /** A precondition another command fulfils is missing: no rows, no grades, no calibration, no sample. */
  NotReady: 2,
  /** An unknown command, flag or value, or a missing argument. */
  Usage: 64,
} as const;
export type CliExit = (typeof CliExit)[keyof typeof CliExit];

/** The exit code of an unknown command or bad usage (sysexits `EX_USAGE`). */
export const EXIT_USAGE = CliExit.Usage;
