import assert from "node:assert/strict";
import { test } from "node:test";
import { newestFixtureBuild, startFakeOllama, stateFixtureBuild } from "../helpers/fake-ollama.ts";
import { makeFakePreview } from "../helpers/studio-rig.ts";

test("a scripted judge reads capture bytes through the wire in either shuffled order", async () => {
  const preview = makeFakePreview();
  const older = (await preview.screenshot()).toString("base64");
  const newer = (await preview.screenshot()).toString("base64");
  const picks: string[] = [];
  const server = await startFakeOllama({
    respond: (request) => {
      picks.push(newestFixtureBuild(request));
      return { text: "judged" };
    },
  });
  try {
    for (const images of [
      [older, newer],
      [newer, older],
    ]) {
      const result = await fetch(`${server.host}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "IMAGES ATTACHED (2): BUILD A / default; BUILD B / default. Look at them." },
                ...images.map((data) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${data}` } })),
              ],
            },
          ],
        }),
      });
      await result.text();
    }
    assert.deepEqual(picks, ["B", "A"]);
    assert.throws(() => newestFixtureBuild({ messages: [] }), /fixture captures/);
  } finally {
    await server.close();
  }
});

test("real-window smoke judging uses authored state in either shuffled order", () => {
  const request = (a: number, b: number) => ({
    messages: [{ content: `Judge\nBUILD A\nstate: {"smokeRevision":${a}}\nBUILD B\nstate: {"smokeRevision":${b}}` }],
  });
  assert.equal(stateFixtureBuild(request(1, 2)), "B");
  assert.equal(stateFixtureBuild(request(2, 1)), "A");
  assert.throws(() => stateFixtureBuild(request(1, 1)), /distinct/);
  assert.throws(() => stateFixtureBuild({ messages: [] }), /distinct/);
});
