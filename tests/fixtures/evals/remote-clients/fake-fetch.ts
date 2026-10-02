/**
 * A scripted `fetch` for the remote-client tests: it records every request and answers from a
 * queue, so no test ever opens the network. An empty queue answers 500, which a test notices.
 */

/** One request the client made, as the fake saw it. */
export interface SeenRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Uint8Array | null;
  credentials: string | undefined;
  redirect: string | undefined;
  signal: AbortSignal | null;
}

/** How the fake answers one request. */
export type Answer = Response | ((request: SeenRequest) => Response | Promise<Response>);

/** A JSON response with a status. */
export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that records requests and answers them in order. */
export function fakeFetch(answers: Answer[] = []) {
  const seen: SeenRequest[] = [];
  const queue = [...answers];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const raw = init.body;
    const body = typeof raw === "string" || raw instanceof Uint8Array ? raw : null;
    const request: SeenRequest = {
      url: String(input),
      method: init.method ?? "GET",
      headers,
      body,
      credentials: init.credentials,
      redirect: init.redirect,
      signal: init.signal ?? null,
    };
    seen.push(request);
    const answer = queue.shift() ?? json(500, { code: "not-found" });
    return typeof answer === "function" ? answer(request) : answer;
  };
  return { fetch, seen, pending: () => queue.length };
}

/** A request that never answers until its signal aborts, as a hung server would. */
export const hang = (request: SeenRequest): Promise<Response> =>
  new Promise((_, reject) => {
    request.signal?.addEventListener("abort", () => reject(request.signal?.reason));
  });
