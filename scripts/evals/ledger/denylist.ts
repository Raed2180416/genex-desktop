/**
 * The ledger guard's layer 2 (§9.3): the denylist every string and map key of a row is tested
 * against: absolute and home paths, emails, credential shapes (`src/shared/redact.ts`), JWT heads,
 * eval ingest keys, long base64 runs, anything over 120 characters, and internal domains. It lives
 * apart from `guard.ts` (which adds the closed schema) so that definitions the schema itself reads,
 * such as the lane registry, can check their ids with it without an import cycle.
 */
import { containsSecret } from "../../../src/shared/redact.ts";
import { EVALS_INGEST_KEY_PREFIX } from "../remote/contract.ts";

/** Why the guard refused a value. */
export const GuardRule = {
  Schema: "schema",
  AbsolutePath: "absolute-path",
  Email: "email",
  Secret: "secret",
  Jwt: "jwt",
  IngestKey: "ingest-key",
  Base64: "base64",
  TooLong: "too-long",
  InternalDomain: "internal-domain",
} as const;
export type GuardRule = (typeof GuardRule)[keyof typeof GuardRule];

/** The longest string a guarded value may hold. */
export const MAX_GUARDED_STRING_LENGTH = 120;
/** The longest base64-looking run a guarded value may hold. */
export const MAX_BASE64_RUN = 256;

/** Domains that are ours and never belong in a committed or shared row. */
export const INTERNAL_DOMAINS: readonly string[] = ["genex.games", "auras.cc", "r2.dev", "r2.cloudflarestorage.com"];

/** Home and system roots on macOS, Linux and Windows, a tilde home, and a UNC share. */
const ABSOLUTE_PATH =
  /\/(?:Users|home|root|private|var|tmp|Volumes)\/|(?:^|[^A-Za-z])[A-Za-z]:[\\/]|~[\\/]|\\\\[\w.-]+\\/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/;
const JWT_HEAD = /eyJ[\w-]{8,}/;
const BASE64_RUN = new RegExp(`[A-Za-z0-9+/=_-]{${MAX_BASE64_RUN + 1},}`);

/** The rules a string is tested against, in the order a finding is named. */
const TEXT_RULES: ReadonlyArray<readonly [GuardRule, (text: string) => boolean]> = [
  [GuardRule.IngestKey, (text) => text.includes(EVALS_INGEST_KEY_PREFIX)],
  [GuardRule.Jwt, (text) => JWT_HEAD.test(text)],
  [GuardRule.Secret, containsSecret],
  [GuardRule.Email, (text) => EMAIL.test(text)],
  [GuardRule.AbsolutePath, (text) => ABSOLUTE_PATH.test(text)],
  [GuardRule.InternalDomain, (text) => INTERNAL_DOMAINS.some((domain) => text.toLowerCase().includes(domain))],
  [GuardRule.Base64, (text) => BASE64_RUN.test(text)],
  [GuardRule.TooLong, (text) => text.length > MAX_GUARDED_STRING_LENGTH],
];

/** The first denylist rule `text` breaks, or null when it is clean. */
export function denylistRule(text: string): GuardRule | null {
  for (const [rule, hits] of TEXT_RULES) if (hits(text)) return rule;
  return null;
}

/**
 * Whether an id (a lane, case or campaign label) is one the guard accepts in every row that
 * carries it. Definitions check this up front, so an id such as `sk-8ball` (credential-shaped to
 * `redact.ts`) is refused when it is defined, not after a paid run when its row is written.
 */
export function isLedgerSafeId(id: string): boolean {
  return denylistRule(id) === null;
}
