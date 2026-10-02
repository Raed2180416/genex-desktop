// In-memory only: the count restarts with the backend process, which is the point of the demo badge.
let calls = 0;
export async function activate() {
  return {
    async tool(name, args, ctx) {
      calls++;
      if (name === "shout") return { text: String(args.text).toUpperCase(), project: ctx.project };
      const s = await ctx.host("settings.read");
      return { text: s.greeting + " " + args.name, project: ctx.project };
    },
    async action(name) {
      if (name === "count") return { badge: String(calls) };
      calls++;
      return { text: "The isolated plugin backend is working." };
    },
  };
}
