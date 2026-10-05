import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DiffTone, editDiff, patchDiff } from "../../src/renderer/edit-diff.ts";

const shown = (lines: Array<{ text: string; tone: string }>) => lines.map(({ tone, text }) => `${tone} ${text}`);

describe("the exact edit's diff", () => {
  it("shows an appended paragraph under the line it follows, not as a bare block", () => {
    const before = ["# Skill", "", "## Ownership", "Own one module.", "", "(guidance below)"].join("\n");
    const after = `${before}\n\n## Late changes\nList them.`;
    assert.deepEqual(shown(editDiff(before, after)), [
      `${DiffTone.Gap} `,
      `${DiffTone.Ctx} `,
      `${DiffTone.Ctx} (guidance below)`,
      `${DiffTone.Add} `,
      `${DiffTone.Add} ## Late changes`,
      `${DiffTone.Add} List them.`,
    ]);
  });

  it("keeps a replaced line beside its replacement, in file order", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "D", "e", "f", "g", "h"].join("\n");
    assert.deepEqual(shown(editDiff(before, after)), [
      `${DiffTone.Gap} `,
      `${DiffTone.Ctx} b`,
      `${DiffTone.Ctx} c`,
      `${DiffTone.Del} d`,
      `${DiffTone.Add} D`,
      `${DiffTone.Ctx} e`,
      `${DiffTone.Ctx} f`,
      `${DiffTone.Gap} `,
    ]);
  });

  it("shows an added line even when the same text already appears elsewhere in the file", () => {
    const before = ["- Check the camera.", "## Next", "Text."].join("\n");
    const after = ["- Check the camera.", "## Next", "Text.", "- Check the camera."].join("\n");
    const added = editDiff(before, after).filter((line) => line.tone === DiffTone.Add);
    assert.deepEqual(added, [{ text: "- Check the camera.", tone: DiffTone.Add }]);
  });

  it("separates two distant edits with one gap and shows nothing for an unchanged file", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const after = [...lines];
    after[2] = "changed 2";
    after[17] = "changed 17";
    const tones = editDiff(lines.join("\n"), after.join("\n")).map((line) => line.tone);
    assert.equal(tones.filter((tone) => tone === DiffTone.Gap).length, 1);
    assert.equal(tones.filter((tone) => tone === DiffTone.Add).length, 2);
    assert.deepEqual(editDiff("same\ntext", "same\ntext"), []);
  });

  it("shows a new file as all additions", () => {
    assert.deepEqual(shown(editDiff("", "one\ntwo")), [`${DiffTone.Add} one`, `${DiffTone.Add} two`]);
  });
});

describe("a learned change's patch", () => {
  it("reads hunks and leaves out the file headers git writes above them", () => {
    const patch = [
      "diff --git a/skills/plan.md b/skills/plan.md",
      "index 1234567..89abcde 100644",
      "--- a/skills/plan.md",
      "+++ b/skills/plan.md",
      "@@ -3,2 +3,3 @@ heading",
      " kept line",
      "-old line",
      "+new line",
      "+--- a markdown rule the edit added",
      "\\ No newline at end of file",
    ].join("\n");
    assert.deepEqual(shown(patchDiff(patch)), [
      `${DiffTone.Gap} `,
      `${DiffTone.Ctx} kept line`,
      `${DiffTone.Del} old line`,
      `${DiffTone.Add} new line`,
      `${DiffTone.Add} --- a markdown rule the edit added`,
    ]);
  });

  it("caps a long patch at the lines it can show", () => {
    const patch = ["@@ -1,0 +1,5 @@", "+a", "+b", "+c", "+d", "+e"].join("\n");
    assert.equal(patchDiff(patch, 3).length, 3);
  });
});
