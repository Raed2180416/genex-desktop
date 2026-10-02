/**
 * Which renderer headless Chromium ran on (S5): ANGLE Metal first, SwiftShader as the fallback, the
 * WebGL renderer string read back to decide, and fps rows that stop gating on software. No browser.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chromiumArgs,
  classifyRenderer,
  fpsRowsGate,
  launchWithFallback,
} from "../../scripts/evals/prober/renderer.ts";
import { RendererMode } from "../../scripts/evals/vocabulary.ts";

describe("renderer detection", () => {
  const table: Array<[string | null, RendererMode | null]> = [
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)", RendererMode.Gpu],
    [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      RendererMode.Software,
    ],
    ["Google SwiftShader", RendererMode.Software],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", RendererMode.Software],
    ["Apple M2", RendererMode.Gpu],
    ["", null],
    [null, null],
  ];
  for (const [renderer, mode] of table) {
    it(`reads ${JSON.stringify(renderer)} as ${mode}`, () => assert.equal(classifyRenderer(renderer), mode));
  }

  it("asks for ANGLE Metal on the GPU path and SwiftShader on the software path", () => {
    assert.ok(chromiumArgs(RendererMode.Gpu).includes("--use-angle=metal"));
    assert.ok(!chromiumArgs(RendererMode.Gpu).some((a) => a.includes("swiftshader")));
    assert.ok(chromiumArgs(RendererMode.Software).includes("--use-angle=swiftshader"));
    for (const mode of Object.values(RendererMode)) {
      assert.ok(chromiumArgs(mode).includes("--enable-precise-memory-info"), "heap readings must not be quantised");
    }
  });

  it("frame-rate rows gate on a GPU and never on a software rasteriser", () => {
    assert.equal(fpsRowsGate(RendererMode.Gpu), true);
    assert.equal(fpsRowsGate(RendererMode.Software), false);
  });
});

describe("launchWithFallback", () => {
  it("uses the GPU when it launches", async () => {
    const tried: RendererMode[] = [];
    const out = await launchWithFallback(async (mode) => {
      tried.push(mode);
      return `browser:${mode}`;
    }, RendererMode.Gpu);
    assert.deepEqual(tried, [RendererMode.Gpu]);
    assert.deepEqual(out, { browser: "browser:gpu", launched: RendererMode.Gpu, fellBack: false });
  });

  it("falls back to SwiftShader when the GPU launch fails, and says so", async () => {
    const tried: RendererMode[] = [];
    const out = await launchWithFallback(async (mode) => {
      tried.push(mode);
      if (mode === RendererMode.Gpu) throw new Error("no GPU process");
      return `browser:${mode}`;
    }, RendererMode.Gpu);
    assert.deepEqual(tried, [RendererMode.Gpu, RendererMode.Software]);
    assert.deepEqual(out, { browser: "browser:software", launched: RendererMode.Software, fellBack: true });
  });

  it("a software request never tries the GPU, and a software failure is not swallowed", async () => {
    const tried: RendererMode[] = [];
    await assert.rejects(
      launchWithFallback(async (mode) => {
        tried.push(mode);
        throw new Error("no browser installed");
      }, RendererMode.Software),
      /no browser installed/,
    );
    assert.deepEqual(tried, [RendererMode.Software]);
  });
});
