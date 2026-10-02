import { createRoot } from "react-dom/client";
import manifest from "../../src/plugins/genex/plugin.json" with { type: "json" };
import { GenexAccount } from "../../src/renderer/panels/plugins/genex/GenexAccount.tsx";
import { useGenexStatus } from "../../src/renderer/panels/plugins/genex/use-genex-status.ts";

// The host's reply when the saved sign-in cannot be read (a fixture profile refuses the Keychain).
const UNLOCK_FAILED =
  "Saved account could not be unlocked. Automatic retries are paused; retry only when you want to allow credential access.";
let credentialState = "locked";
let connects = 0;
const listeners = new Set<(e: any) => void>();
(window as any).studio = {
  onEvent: (fn: any) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  pluginAction: async (_id: string, name: string) => {
    if (name === "status") return { connected: false, credentialState, jobs: [] };
    if (name === "connect") {
      connects++;
      credentialState = "failed";
      throw new Error(UNLOCK_FAILED);
    }
    return {};
  },
  pluginReview: () => {
    throw new Error("Unexpected confirmation");
  },
};
(window as any).test = { connects: () => connects };

function Card() {
  const live = useGenexStatus({ manifest, enabled: true } as any, null);
  return <GenexAccount live={live} />;
}
createRoot(document.getElementById("root")!).render(<Card />);
