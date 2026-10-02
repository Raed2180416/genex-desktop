/** Counts link to their ledger; free-form learning notes remain intact. */
export function learningParts(text: string): Array<{ text: string; link: boolean }> {
  return text.split(" · ").flatMap((part) => {
    const count = part.trim().match(/^(\d+) (?:past tasks? reviewed|proposed|applied|rejected)$/i);
    if (count && Number(count[1]) === 0) return [];
    return part.trim() ? [{ text: part.trim(), link: Boolean(count) }] : [];
  });
}
