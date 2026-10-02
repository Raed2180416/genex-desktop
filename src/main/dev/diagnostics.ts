import { contentTracing, type WebContents } from "electron";
import fs from "node:fs/promises";
import { safeChild } from "../../../scripts/studio-dev/files.mjs";
import { DevError, DevErrorCode } from "./protocol.ts";
import type { DesktopControl } from "./control.ts";
import { MainProfiler } from "./main-profile.ts";
export class Diagnostics {
  root: string;
  control: DesktopControl;
  cpu = new Map<WebContents, string>();
  main = new MainProfiler();
  trace: { id: string; timer: NodeJS.Timeout; result?: Promise<string> } | null = null;
  constructor(root: string, control: DesktopControl) {
    this.root = root;
    this.control = control;
  }
  async destination(name: string) {
    const dest = safeChild(this.root, name);
    try {
      await fs.access(dest);
      throw new DevError(DevErrorCode.Busy, "artifact already exists; choose a new name");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return dest;
  }
  async cpuStart(wc: WebContents, id: string) {
    if (this.cpu.has(wc)) throw new DevError(DevErrorCode.Busy, "CPU profile already active");
    await this.control.cdp(wc, "Profiler.enable");
    await this.control.cdp(wc, "Profiler.start");
    this.cpu.set(wc, id);
    return { started: id };
  }
  async cpuStop(wc: WebContents, id: string, surface: string) {
    if (this.cpu.get(wc) !== id)
      throw new DevError(DevErrorCode.MissingPrerequisite, "matching CPU profile has not started");
    const file = await this.destination(`${surface}-${id}.cpuprofile`);
    const { profile } = await this.control.cdp(wc, "Profiler.stop");
    this.cpu.delete(wc);
    if (!Array.isArray(profile.nodes) || typeof profile.endTime !== "number")
      throw new DevError(DevErrorCode.InvalidDiagnostic);
    await fs.writeFile(file, JSON.stringify(profile), { flag: "wx", mode: 0o600 });
    return { file, surface, nodes: profile.nodes.length };
  }
  async mainCpuStart(id: string) {
    if (!(await this.main.start(id))) throw new DevError(DevErrorCode.Busy, "main CPU profile already active");
    return { started: id, surface: "main" };
  }
  async mainCpuStop(id: string) {
    if (this.main.active !== id)
      throw new DevError(DevErrorCode.MissingPrerequisite, "matching main CPU profile has not started");
    const file = await this.destination(`main-${id}.cpuprofile`);
    const profile = await this.main.stop(id);
    if (!profile || !Array.isArray(profile.nodes) || typeof profile.endTime !== "number")
      throw new DevError(DevErrorCode.InvalidDiagnostic);
    await fs.writeFile(file, JSON.stringify(profile), { flag: "wx", mode: 0o600 });
    return { file, surface: "main", nodes: profile.nodes.length };
  }
  async heap(wc: WebContents, name: string, surface: string) {
    const file = await this.destination(`${surface}-${name}.heapsnapshot`);
    await wc.takeHeapSnapshot(file);
    const bytes = (await fs.stat(file)).size;
    if (!bytes) throw new DevError(DevErrorCode.InvalidDiagnostic);
    return { file, surface, bytes, containsApplicationState: true };
  }
  async traceStart(id: string, durationMs: number, categories: string[]) {
    if (this.trace) throw new DevError(DevErrorCode.Busy, "trace already active or awaiting collection");
    const available = await contentTracing.getCategories();
    if (categories.some((c) => !available.includes(c)))
      throw new DevError(DevErrorCode.UnsupportedSurface, "trace category unavailable");
    const file = await this.destination(`app-${id}.trace.json`);
    await contentTracing.startRecording({ included_categories: categories });
    const record = {
      id,
      timer: setTimeout(() => {
        record.result = contentTracing.stopRecording(file);
        void record.result.catch(() => {});
      }, durationMs),
      result: undefined as Promise<string> | undefined,
    };
    this.trace = record;
    return { started: id, durationMs, surface: "app-chromium" };
  }
  async traceStop(id: string) {
    if (this.trace?.id !== id) throw new DevError(DevErrorCode.MissingPrerequisite, "matching trace has not started");
    const r = this.trace;
    clearTimeout(r.timer);
    r.result ??= contentTracing.stopRecording(safeChild(this.root, `app-${id}.trace.json`));
    const file = await r.result;
    this.trace = null;
    const bytes = (await fs.stat(file)).size;
    if (!bytes) throw new DevError(DevErrorCode.InvalidDiagnostic);
    return { file, bytes, surface: "app-chromium" };
  }
  async stop() {
    if (this.trace) await this.traceStop(this.trace.id);
    for (const [wc, id] of this.cpu) await this.cpuStop(wc, id, "shutdown").catch(() => {});
    const main = this.main.active;
    if (main) await this.main.stop(main).catch(() => {});
  }
}
