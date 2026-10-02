/** The studio's own conversation is where a call that names no thread lands. */

/** The thread a call named, or the studio's main thread when it named none. */
export function threadOr(core: { readonly mainThread: string }, threadId: string | null | undefined): string {
  return threadId ?? core.mainThread;
}
