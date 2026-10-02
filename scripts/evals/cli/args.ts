/**
 * Command-line parsing for the eval commands that `scripts/evals/cli/` owns: positionals, bare
 * `--switch`es and `--name value` pairs. Anything else (an unknown flag, a flag whose value is
 * missing or is itself a flag) makes the whole line unusable, so a handler prints its usage and
 * does nothing.
 */
import { CAMPAIGN_ID_PATTERN } from "../ledger/types.ts";

/** One parsed command line. */
export interface CliArgs {
  positional: string[];
  switches: Set<string>;
  values: Map<string, string>;
}

/** The flags a command knows, spelled with their dashes. */
export interface CliArgSpec {
  switches?: readonly string[];
  values?: readonly string[];
}

/** Split `args` by `spec`; null on an unknown flag or a missing value. */
export function parseCliArgs(args: readonly string[], spec: CliArgSpec): CliArgs | null {
  const parsed: CliArgs = { positional: [], switches: new Set(), values: new Map() };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const value = args[index + 1];
    if (!arg.startsWith("--")) parsed.positional.push(arg);
    else if (spec.switches?.includes(arg)) parsed.switches.add(arg);
    else if (spec.values?.includes(arg) && value !== undefined && !value.startsWith("--")) {
      parsed.values.set(arg, value);
      index += 1;
    } else return null;
  }
  return parsed;
}

/** The single positional campaign id, checked against its pattern (it names folders); null otherwise. */
export function campaignIdOf(parsed: CliArgs | null): string | null {
  if (parsed?.positional.length !== 1) return null;
  const [campaignId = ""] = parsed.positional;
  return CAMPAIGN_ID_PATTERN.test(campaignId) ? campaignId : null;
}
