/** Settings → Licenses: the license texts a build ships, as main reads them from its resources. */
export interface LicenseTexts {
  /** Genex's own MIT license (the repository's LICENSE); null in a build that wrote none. */
  license: string | null;
  /** The generated list of bundled npm packages and their license files (`third-party/NOTICE.md`). */
  bundled: string | null;
  /** THIRD-PARTY-NOTICES.md as shipped (`third-party/PROJECT-SOURCES.md`): copied sources and libraries. */
  notices: string | null;
}
