/** How a delivered file is named on screen: its file name read as words. */

/** A Genex job's own folder: `assets/genex/<job id>/`. */
const GENEX_JOB_FOLDER = /(^|\/)assets\/genex\/[0-9a-f-]{8,}\//i;
/** The 8-character id Genex ends its output names with. */
const GENEX_NAME_ID = /-[a-z0-9]{8}$/i;
/** A file's extension. */
const EXTENSION = /\.[a-z0-9]{1,5}$/i;

/** A file name's words, without its extension or a Genex id. */
function nameWords(file: string): string[] {
  let name = (file.split("/").at(-1) ?? file).replace(EXTENSION, "");
  // Genex names its output `<prompt slug>-<8-character id>` inside the job's own folder.
  if (GENEX_JOB_FOLDER.test(file)) name = name.replace(GENEX_NAME_ID, "");
  return name.split(/[-_\s]+/).filter(Boolean);
}

/** Words as a name: joined, the first letter capitalized; `fallback` when there are none. */
function sentence(words: readonly string[], fallback: string): string {
  const text = words.join(" ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : fallback;
}

/** `referee-whistle-one-sharp-st-cmucttyj.mp3` → `Referee whistle one sharp st`. */
export function assetTitle(file: string): string {
  return sentence(nameWords(file), file.split("/").at(-1) ?? file);
}

/** Whether every name has a word at `index` before its last, the same in each. */
function sharedAt(names: readonly string[][], index: number): boolean {
  const word = names[0]?.[index]?.toLowerCase();
  return names.every((words) => words.length > index + 1 && words[index]?.toLowerCase() === word);
}

/** Clip files' names without the words they all start with: `knight-walk`, `knight-run` → Walk, Run. */
export function clipTitles(files: readonly string[]): string[] {
  const names = files.map(nameWords);
  let shared = 0;
  if (names.length > 1) while (sharedAt(names, shared)) shared += 1;
  return names.map((words, i) => sentence(words.slice(shared), assetTitle(files[i] ?? "")));
}
