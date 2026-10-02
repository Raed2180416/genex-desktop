import { createReadStream } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCreatorMcp, readCreatorCredential } from "./creator-mcp.ts";

try {
  const credential = await readCreatorCredential(createReadStream("", { fd: 3, autoClose: true }));
  const bridge = await createCreatorMcp(credential);
  const transport = new StdioServerTransport();
  await bridge.server.connect(transport);
  // The host owns the lifetime; no daemon or independent saved account survives its pipe.
  process.stdin.once("end", () => {
    void bridge.close();
  });
  process.once("SIGTERM", () => {
    void bridge.close().finally(() => process.exit(0));
  });
} catch {
  // SDK/network exceptions may contain request headers. Keep child stderr credential-free.
  process.stderr.write("Genex MCP unavailable. Check the Genex account and connection in Plugins.\n");
  process.exitCode = 1;
}
