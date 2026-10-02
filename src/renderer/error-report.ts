/**
 * The text the error screen's "Copy error" puts on the clipboard: what was thrown, its stack and
 * the React components it was thrown in, with anything credential-shaped removed.
 */
import { redactSecrets } from "../shared/redact.ts";

export function errorReport(error: unknown, componentStack: string | null | undefined): string {
  const thrown = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  const components = componentStack?.trim() ? `\n\nComponents:\n    ${componentStack.trim()}` : "";
  return redactSecrets(`${thrown}${components}`);
}
