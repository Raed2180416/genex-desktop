/**
 * Blender under the studio's own sandbox — AG-930 M0.
 *
 * Real Blender, real Seatbelt: the whole point of the runner is that Blender (which srt cannot
 * host) still runs contained. Skips with a reason on a Mac without Blender; every other machine
 * proves the boundary from both sides — a script that models exports and renders, a script that
 * raises exits 1, a write outside the allow-list is refused, a runaway is killed as a tree.
 */
import assert from "node:assert/strict";
import { access, constants, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { runNativeProcess } from "../../src/substrate/plugins/native-process.ts";
import {
  BLENDER_RENDER_SIZE,
  BLENDER_WRAPPER_PY,
  STUDIO_BLENDER_RESULT,
  frontRenderPath,
} from "../../src/plugins/blender/wrapper.ts";
import { tmpDir } from "../helpers/tmp.ts";

const BLENDER = process.env.STUDIO_TEST_BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";

async function haveBlender(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await access(BLENDER, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const SKIP = !(await haveBlender()) && `no Blender at ${BLENDER}`;

function resultLine(stdout: string): Record<string, unknown> | null {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(STUDIO_BLENDER_RESULT));
  return line ? (JSON.parse(line.slice(STUDIO_BLENDER_RESULT.length)) as Record<string, unknown>) : null;
}

async function setup(): Promise<{
  root: string;
  ws: string;
  assets: string;
  out: string;
  scratch: string;
  wrapper: string;
}> {
  const root = await tmpDir("studio-blender-");
  const ws = path.join(root, "ws");
  const assets = path.join(ws, "assets");
  const out = path.join(root, "runs", "run_x", "facet_a", "blender");
  const scratch = path.join(root, "scratch");
  await mkdir(path.join(assets, "src"), { recursive: true });
  await mkdir(out, { recursive: true });
  await mkdir(scratch, { recursive: true });
  const wrapper = path.join(scratch, "wrapper.py");
  await writeFile(wrapper, BLENDER_WRAPPER_PY);
  return { root, ws, assets, out, scratch, wrapper };
}

/** Keep the original geometry/error/timeout assertions while exercising the new generic runner. */
async function runBlender(p: {
  binary: string;
  script: string;
  args: string[];
  cwd: string;
  allowWrite: string[];
  denyRead: string[];
  scratch: string;
  timeoutMs: number;
}) {
  const start = Date.now();
  const bundle = p.binary.includes(".app/") ? p.binary.slice(0, p.binary.indexOf(".app/") + 4) : path.dirname(p.binary);
  const result = await runNativeProcess({
    binary: p.binary,
    args: ["-b", "--factory-startup", "-noaudio", "--python-exit-code", "1", "--python", p.script, "--", ...p.args],
    cwd: p.cwd,
    scratch: p.scratch,
    reads: [bundle, p.cwd],
    writes: p.allowWrite,
    denyRead: p.denyRead,
    gpu: true,
    signal: new AbortController().signal,
    timeoutMs: p.timeoutMs,
    maxOutputBytes: 64000,
  });
  return { ...result, durationMs: Date.now() - start, timedOut: result.reason === "timeout" };
}

const MODEL_PY = `
import bpy
bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=1.2, location=(0, 0, 0.6))
body = bpy.context.active_object
mat = bpy.data.materials.new("bark")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.4, 0.25, 0.1, 1)
body.data.materials.append(mat)
bpy.ops.mesh.primitive_ico_sphere_add(radius=0.8, subdivisions=2, location=(0, 0, 1.6))
crown = bpy.context.active_object
leaf = bpy.data.materials.new("leaf")
leaf.use_nodes = True
leaf.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.1, 0.5, 0.15, 1)
crown.data.materials.append(leaf)
`;

describe("blender under the studio's sandbox (AG-930)", () => {
  it("the generic native profile is deny-by-default, scopes reads and writes, and denies network", {
    skip: process.platform !== "darwin",
  }, async () => {
    const root = await tmpDir("native-profile-");
    const result = await runNativeProcess({
      binary: "/bin/echo",
      args: ["ready"],
      cwd: root,
      scratch: root,
      reads: [],
      writes: [],
      denyRead: ["/Users/fixture/secrets"],
      signal: new AbortController().signal,
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });
    assert.equal(result.code, 0, result.reason);
    assert.match(result.stdout, /ready/);
    const text = await readFile(path.join(root, "native.sb"), "utf8");
    assert.match(text, /^\(version 1\)\n\(deny default\)/);
    assert.match(text, /\(deny network\*\)/);
    assert.match(text, /\(deny file-read\*/);
    assert.ok(!text.includes("(allow file-read*)"), "no unrestricted file reads");
  });

  it("models, exports a GLB into assets/ and renders a PNG into the run folder", { skip: SKIP }, async () => {
    const { ws, assets, out, scratch, wrapper } = await setup();
    const script = path.join(assets, "src", "tree.py");
    await writeFile(script, MODEL_PY);
    const glb = path.join(assets, "tree.glb");
    const png = path.join(out, "tree-1.png");
    const result = await runBlender({
      binary: BLENDER,
      script: wrapper,
      args: [script, glb, png, "tree"],
      cwd: ws,
      allowWrite: [assets, out],
      denyRead: [],
      scratch,
      timeoutMs: 60_000,
    });
    const parsed = resultLine(result.stdout);
    assert.ok(
      parsed && parsed.ok === true,
      `result line: ${JSON.stringify(parsed)}\nstderr: ${result.stderr.slice(-800)}\nstdout: ${result.stdout.slice(-800)}`,
    );
    assert.equal(result.code, 0);
    assert.equal(parsed.meshCount, 2);
    const meshes = parsed.meshes as Array<{ name: string; polygons: number; triangles: number; materials: string[] }>;
    assert.deepEqual(
      meshes.map((m) => [m.name, m.materials]),
      [
        ["Cylinder", ["bark"]],
        ["Icosphere", ["leaf"]],
      ],
      "the result names what is inside the file: object names and their materials",
    );
    assert.deepEqual(parsed.materials, ["bark", "leaf"]);
    assert.ok((parsed.polygons as number) > 50);
    assert.ok(
      (parsed.triangles as number) >= (parsed.polygons as number),
      "triangles are counted beside polygons (an n-gon is n-2 of them)",
    );
    assert.equal(
      parsed.triangles,
      meshes.reduce((sum, m) => sum + m.triangles, 0),
    );
    assert.equal(meshes[1]!.triangles, meshes[1]!.polygons, "an icosphere is all triangles");
    const bytes = await readFile(glb);
    assert.ok(bytes.length > 1024 && bytes.subarray(0, 4).toString("latin1") === "glTF", "a real GLB was written");
    const front = frontRenderPath(png);
    assert.deepEqual(parsed.renders, [png, front]);
    for (const file of [png, front]) {
      const image = await readFile(file);
      assert.equal(image.subarray(1, 4).toString("latin1"), "PNG", `a real PNG was rendered: ${file}`);
      assert.deepEqual(
        [image.readUInt32BE(16), image.readUInt32BE(20)],
        [...BLENDER_RENDER_SIZE],
        `${file} is ${BLENDER_RENDER_SIZE.join("×")}`,
      );
    }
    assert.ok(result.durationMs < 20_000, `${result.durationMs} ms`);
  });

  it("framing leaves a thin tail out: a cube with a long thin cable is framed on the cube", {
    skip: SKIP,
  }, async () => {
    const { ws, assets, out, scratch, wrapper } = await setup();
    const script = path.join(assets, "src", "kettle.py");
    await writeFile(
      script,
      `
import bpy
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
bpy.context.active_object.name = "Body"
bpy.ops.mesh.primitive_cylinder_add(radius=0.004, depth=20.0, location=(0, 0, -10.0))
bpy.context.active_object.name = "Cable"
`,
    );
    const png = path.join(out, "kettle-1.png");
    const result = await runBlender({
      binary: BLENDER,
      script: wrapper,
      args: [script, path.join(assets, "kettle.glb"), png, "kettle"],
      cwd: ws,
      allowWrite: [assets, out],
      denyRead: [],
      scratch,
      timeoutMs: 60_000,
    });
    const parsed = resultLine(result.stdout);
    assert.ok(
      parsed && parsed.ok === true,
      `result line: ${JSON.stringify(parsed)}\nstderr: ${result.stderr.slice(-800)}`,
    );
    const size = parsed.size as number[];
    const framed = parsed.framedSize as number[];
    assert.ok(size[2]! > 19, `the asset itself is ${size[2]} tall — the cable is in the file`);
    assert.ok(
      Math.abs(framed[2]! - 1) < 0.01 && Math.abs(framed[0]! - 1) < 0.01,
      `the frame is the cube: ${framed.join(" × ")}`,
    );
    const meshes = parsed.meshes as Array<{ name: string; materials: string[] }>;
    assert.deepEqual(
      meshes.map((m) => [m.name, m.materials]),
      [
        ["Body", []],
        ["Cable", []],
      ],
      "a mesh without a material says so",
    );
    assert.deepEqual(parsed.materials, []);
    await readFile(frontRenderPath(png));
  });

  it("a script that raises exits 1 with the traceback in the result line", { skip: SKIP }, async () => {
    const { ws, assets, out, scratch, wrapper } = await setup();
    const script = path.join(assets, "src", "bad.py");
    await writeFile(script, "import bpy\nraise RuntimeError('no such primitive')\n");
    const result = await runBlender({
      binary: BLENDER,
      script: wrapper,
      args: [script, path.join(assets, "bad.glb"), path.join(out, "bad-1.png"), "bad"],
      cwd: ws,
      allowWrite: [assets, out],
      denyRead: [],
      scratch,
      timeoutMs: 60_000,
    });
    const parsed = resultLine(result.stdout);
    assert.equal(result.code, 1, "--python-exit-code 1 turns the exception into a non-zero exit");
    assert.ok(parsed && parsed.ok === false);
    assert.match(String(parsed.error), /no such primitive/);
  });

  it("a script cannot write outside the allow-list, and cannot reach the network", { skip: SKIP }, async () => {
    const { root, ws, assets, out, scratch, wrapper } = await setup();
    const outside = path.join(root, "outside");
    await mkdir(outside, { recursive: true });
    const script = path.join(assets, "src", "escape.py");
    await writeFile(
      script,
      `
import bpy, socket
errors = []
try:
    open(${JSON.stringify(path.join(outside, "x.txt"))}, "w").write("escaped")
except Exception as e:
    errors.append("write: " + type(e).__name__ + " " + str(e))
try:
    s = socket.create_connection(("1.1.1.1", 443), timeout=3)
    s.close()
except Exception as e:
    errors.append("net: " + type(e).__name__)
raise RuntimeError(" | ".join(errors))
`,
    );
    const result = await runBlender({
      binary: BLENDER,
      script: wrapper,
      args: [script, path.join(assets, "escape.glb"), path.join(out, "escape-1.png"), "escape"],
      cwd: ws,
      allowWrite: [assets, out],
      denyRead: [],
      scratch,
      timeoutMs: 60_000,
    });
    const parsed = resultLine(result.stdout);
    assert.ok(parsed && parsed.ok === false, JSON.stringify(parsed));
    assert.match(String(parsed.error), /write: PermissionError/, "the write outside the allow-list is refused");
    assert.match(String(parsed.error), /net: /, "the socket is refused");
    await assert.rejects(readFile(path.join(outside, "x.txt")), "nothing escaped");
  });

  it("a runaway script is killed as a process tree at the timeout", { skip: SKIP }, async () => {
    const { ws, assets, out, scratch, wrapper } = await setup();
    const script = path.join(assets, "src", "sleep.py");
    await writeFile(script, "import time\ntime.sleep(60)\n");
    const result = await runBlender({
      binary: BLENDER,
      script: wrapper,
      args: [script, path.join(assets, "sleep.glb"), path.join(out, "sleep-1.png"), "sleep"],
      cwd: ws,
      allowWrite: [assets, out],
      denyRead: [],
      scratch,
      timeoutMs: 3_000,
    });
    assert.equal(result.timedOut, true);
    assert.ok(result.pid);
    assert.throws(() => process.kill(result.pid!, 0), "the process is gone");
  });
});
