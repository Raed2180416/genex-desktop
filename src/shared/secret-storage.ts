/**
 * Why Studio's secret store is locked. Main refuses to keep a secret it cannot encrypt with the
 * operating system's own key store; the renderer turns the code into words (`renderer/words.ts`).
 * Browser-safe.
 */
export const SecretStorageIssue = {
  /** `STUDIO_DISABLE_OS_CREDENTIALS=1`: this process may not touch the OS key store at all. */
  OsCredentialsDisabled: "os-credentials-disabled",
  /** The OS offers no encryption to this process (a headless run, no Electron). */
  EncryptionUnavailable: "encryption-unavailable",
  /** Linux with no keyring or wallet: Electron would fall back to a fixed, public key. */
  NoKeyring: "no-keyring",
} as const;
export type SecretStorageIssue = (typeof SecretStorageIssue)[keyof typeof SecretStorageIssue];
