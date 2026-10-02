/**
 * The subscription engines, in preference order — "your subscription, through their harness"
 * (D8). They come from the app's provider table (`shared/providers.ts`), not from the harness
 * seed: the harness is agent-writable, and which engines exist is a fact about the app.
 */
export { SUBSCRIPTION_ENGINES } from "../../shared/providers.ts";
