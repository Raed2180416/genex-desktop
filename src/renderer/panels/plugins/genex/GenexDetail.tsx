/**
 * The Genex plugin's page, below its title: the account card, what Genex makes, its connections,
 * the skills it gives agents and what it is. The page is app-wide: one balance covers every game,
 * a game's own spend is in its usage panel, and Publish lives on the game's stage.
 */
import type { JSX } from "react";
import { GenexAction } from "../../../../shared/genex.ts";
import type { PluginInfo } from "../../../../shared/plugins.ts";
import { Button } from "../../../ui/Button.tsx";
import { Icon, type IconName } from "../../../ui/icons.tsx";
import { GENEX_WORDS } from "../../../words.ts";
import { PluginApproval } from "../../PluginApproval.tsx";
import { Information, PluginNotes, PluginSkills, UpdateButton } from "../detail-parts.tsx";
import { isActive } from "../labels.ts";
import type { PluginsPage } from "../page.ts";
import { PluginConnections } from "../PluginConnections.tsx";
import { Section } from "../rows.tsx";
import type { ShownSkill } from "../skills-sections.ts";
import { GenexAccount } from "./GenexAccount.tsx";
import { type GenexJobRow, genexJobRows, JobState } from "./genex-view.ts";
import { type GenexLive, useGenexStatus } from "./use-genex-status.ts";

const MAKES: ReadonlyArray<[IconName, { title: string; text: string }]> = [
  ["box", GENEX_WORDS.makes.models],
  ["character", GENEX_WORDS.makes.characters],
  ["image", GENEX_WORDS.makes.art],
  ["sound", GENEX_WORDS.makes.sound],
];

/** What Genex can make, and how to ask for it. */
function Makes(): JSX.Element {
  return (
    <Section title={GENEX_WORDS.makes.title} hooks={{ "data-genex-makes": "" }}>
      <p className="genex-section-intro">{GENEX_WORDS.makes.intro}</p>
      <ul className="genex-makes">
        {MAKES.map(([icon, words]) => (
          <li key={words.title}>
            <span className="genex-make-icon" aria-hidden="true">
              <Icon name={icon} size={20} />
            </span>
            <span className="genex-make-copy">
              <span className="genex-make-title">{words.title}</span>
              <span className="genex-make-text">{words.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** One generation that waits for the person: what it is, and a Review button per candidate. */
function ReviewRow({ row, live }: { row: GenexJobRow; live: GenexLive }): JSX.Element {
  return (
    <li className="genex-job" data-genex-job={row.state}>
      <span className="genex-job-icon" aria-hidden="true">
        <Icon name={row.icon} size={16} />
      </span>
      <span className="genex-job-copy">
        <span className="genex-job-title">{row.label}</span>
      </span>
      <span className="genex-job-state" data-state={row.state}>
        {GENEX_WORDS.state[row.state]}
      </span>
      <div className="genex-job-actions">
        {row.candidates.map((candidate) => (
          <Button
            key={candidate ?? "remesh"}
            disabled={live.running !== null}
            onClick={() => void live.act(GenexAction.Approve, { id: row.id, ...(candidate ? { candidate } : {}) })}
          >
            {GENEX_WORDS.review.button(candidate)}
          </Button>
        ))}
      </div>
    </li>
  );
}

/**
 * The open game's generations that wait for the person (a character's candidates, a remesh):
 * the page is app-wide, but a decision only the person can make is shown where they look for Genex.
 */
function WaitingForReview({ live }: { live: GenexLive }): JSX.Element | null {
  const rows = genexJobRows(live.status?.jobs ?? []).filter((row) => row.state === JobState.Review);
  if (!rows.length) return null;
  return (
    <Section title={GENEX_WORDS.review.title} count={rows.length} hooks={{ "data-genex-review": "" }}>
      <ul className="genex-jobs">
        {rows.map((row) => (
          <ReviewRow key={row.id} row={row} live={live} />
        ))}
      </ul>
    </Section>
  );
}

/** The account card (the shared balance, never a game's spend) and what waits for review in the open game. */
function LiveAccount({ detail, page }: { detail: PluginInfo; page: PluginsPage }): JSX.Element {
  const live = useGenexStatus(detail, page.project);
  return (
    <>
      <GenexAccount live={live} problem={page.error} />
      <WaitingForReview live={live} />
      {live.review && <PluginApproval review={live.review} onClose={live.closeReview} />}
    </>
  );
}

/** The Genex page below its title. */
export function GenexDetail({
  detail,
  page,
  onSkill,
}: {
  detail: PluginInfo;
  page: PluginsPage;
  onSkill: (skill: ShownSkill) => void;
}): JSX.Element {
  const active = isActive(detail);
  return (
    <div className="genex-page">
      <PluginNotes detail={detail} />
      <div className="extensions-detail-actions">
        <UpdateButton detail={detail} page={page} />
      </div>
      {active ? (
        <LiveAccount detail={detail} page={page} />
      ) : (
        <>
          <p className="genex-off">{GENEX_WORDS.account.off}</p>
          {page.error && (
            <p role="alert" className="extensions-error">
              {page.error}
            </p>
          )}
        </>
      )}
      <Makes />
      <PluginConnections plugin={detail} page={page} names={GENEX_WORDS.connections} />
      <PluginSkills detail={detail} onSkill={onSkill} />
      <Information detail={detail} />
    </div>
  );
}
