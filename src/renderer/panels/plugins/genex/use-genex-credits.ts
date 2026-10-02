/** Genex's balance for its Plugins row: read once its account is connected, and again when it changes. */
import { useState } from "react";
import { GENEX_PLUGIN_ID, GenexAction } from "../../../../shared/genex.ts";
import { type PluginInfo, PluginAccountState } from "../../../../shared/plugins.ts";
import { useAsyncEffect } from "../../../use-async-effect.ts";
import { type AccountState, isActive } from "../labels.ts";
import { type CreditsView, creditsOf, isGenexStatus } from "./genex-view.ts";

/** The balance, or null while Genex is off, not connected, or not read yet. `version` re-reads it. */
export function useGenexCredits(
  plugins: PluginInfo[],
  account: AccountState,
  version: unknown = null,
): CreditsView | null {
  const [credits, setCredits] = useState<CreditsView | null>(null);
  const genex = plugins.find((p) => p.manifest.id === GENEX_PLUGIN_ID);
  const connected = Boolean(genex && isActive(genex)) && account === PluginAccountState.Unlocked;
  useAsyncEffect(
    (alive) => {
      if (!connected) {
        setCredits(null);
        return;
      }
      window.studio.pluginAction(GENEX_PLUGIN_ID, GenexAction.Status, {}).then(
        (status) => alive() && setCredits(isGenexStatus(status) ? creditsOf(status) : null),
        () => alive() && setCredits(null),
      );
    },
    [connected, version],
  );
  return credits;
}
