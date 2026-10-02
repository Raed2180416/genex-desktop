/** Locale-independent order for fixed-format log ids and ISO timestamps. */
export function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
