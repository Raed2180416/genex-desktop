/**
 * A GitHub link as a person pastes it, read into what an install needs: the repository, and the
 * folder, version or commit the link names. Anything that is not a public github.com repository
 * link reads as null. The pinned `owner/repo[/subdir]@sha` spec developers use still reads.
 */

/** What a pasted link names. With no ref or sha, the install takes the latest release. */
export interface GithubLink {
  owner: string;
  name: string;
  /** `owner/name`. */
  repo: string;
  /** A branch, tag or release the link names. */
  ref?: string;
  /** The plugin's folder inside the repository. */
  subdir?: string;
  /** A full commit the link names. */
  sha?: string;
}

const NAME = /^[A-Za-z0-9_.-]+$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const SHA = /^[a-f0-9]{40}$/i;
const HOSTS = new Set(["github.com", "www.github.com"]);
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
/** A decoded path segment may not hide a separator, a control character or a step up. */
const UNSAFE_SEGMENT = /[/\\\u0000-\u001f\u007f]/;
/** The GitHub page sections whose next segment is a ref, and those that name the latest release. */
const REF_SECTIONS = new Set(["tree", "blob"]);
const MANIFEST = "plugin.json";

const isName = (value: string): boolean => NAME.test(value) && value !== "." && value !== "..";

/** A path segment with its percent-escapes decoded, or null when it hides anything unsafe. */
function segment(raw: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const unsafe = !value || value === "." || value === ".." || UNSAFE_SEGMENT.test(value);
  return unsafe ? null : value;
}

/** The repository and what its path names, from `owner/name/...` segments. */
function fromSegments(parts: string[]): GithubLink | null {
  const [owner = "", rawName = "", section, ...rest] = parts;
  const name = rawName.endsWith(".git") ? rawName.slice(0, -4) : rawName;
  if (!isName(owner) || !isName(name)) return null;
  const link: GithubLink = { owner, name, repo: `${owner}/${name}` };
  const target = section ? sectionTarget(section, rest) : {};
  if (!target) return null;
  return { ...link, ...target };
}

/** The ref, folder or commit a page section names, {} for a section that names none. */
function sectionTarget(section: string, rest: string[]): Omit<GithubLink, "owner" | "name" | "repo"> | null {
  const decoded = rest.map(segment);
  if (decoded.some((part) => part === null)) return null;
  const [first, ...path] = decoded as string[];
  if (section === "commit") return first && SHA.test(first) ? { sha: first.toLowerCase() } : {};
  if (section === "releases") return rest[0] === "tag" && rest[1] ? refTarget(decoded[1] as string, []) : {};
  if (!REF_SECTIONS.has(section) || !first) return {};
  // A blob link points at a file: its folder is the plugin's.
  const folder = section === "blob" ? path.slice(0, -1) : path;
  return refTarget(first, folder);
}

function refTarget(ref: string, folder: string[]): Omit<GithubLink, "owner" | "name" | "repo"> | null {
  const subdir = folder.length ? { subdir: folder.join("/") } : {};
  if (SHA.test(ref)) return { sha: ref.toLowerCase(), ...subdir };
  return REF.test(ref) ? { ref, ...subdir } : null;
}

/** The pinned spec: `owner/repo[/subdir]@<40-character sha>`. */
function fromSpec(text: string): GithubLink | null {
  const at = text.lastIndexOf("@");
  const sha = text.slice(at + 1);
  if (!SHA.test(sha)) return null;
  const parts = text.slice(0, at).split("/");
  const link = fromSegments(parts.slice(0, 2));
  const folder = parts.slice(2).map(segment);
  if (!link || folder.some((part) => part === null)) return null;
  return { ...link, ...(folder.length ? { subdir: folder.join("/") } : {}), sha: sha.toLowerCase() };
}

/** A pasted GitHub link (or `owner/repo`, or a pinned spec) read into its parts; null when it is none. */
export function parseGithubLink(input: string): GithubLink | null {
  const text = input.trim();
  if (!text || /\s|\\/.test(text)) return null;
  const scheme = SCHEME.exec(text);
  if (!scheme && text.includes("@")) return fromSpec(text);
  if (scheme && !/^https?$/i.test(scheme[1] ?? "")) return null;
  const rest = scheme ? text.slice(scheme[0].length) : text;
  const [location = ""] = rest.split(/[?#]/);
  const parts = location.split("/").filter((part, index, all) => part !== "" || index < all.length - 1);
  if (parts.includes("")) return null;
  const hosted = HOSTS.has((parts[0] ?? "").toLowerCase());
  if (scheme && !hosted) return null;
  if (hosted) return fromSegments(parts.slice(1));
  // Without a host, only `owner/name` itself: `acme/tools/tree/main` is too easily a path elsewhere.
  return parts.length === 2 ? fromSegments(parts) : null;
}

/** The pinned spec the installer takes for a repository, folder and commit. */
export const pinnedSpec = (repo: string, sha: string, subdir?: string): string =>
  `${repo}${subdir ? `/${subdir}` : ""}@${sha}`;

/** Whether a repository path is a plugin's manifest, and the folder it names. */
export function manifestFolder(path: string): string | null {
  if (path === MANIFEST) return "";
  return path.endsWith(`/${MANIFEST}`) ? path.slice(0, -MANIFEST.length - 1) : null;
}
