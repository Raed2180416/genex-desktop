/**
 * The tools Genex routes, as its plugin page lists them and its picture plays them: one id each,
 * the mark it is shown with (bundled under `media/tools`), and the order of both. The names and
 * what each one does are user copy, in `GENEX_WORDS.router.tools`.
 */
import { GENEX_WORDS } from "../../../words.ts";

/** A tool Genex routes. */
export const RoutedTool = {
  Tripo: "tripo",
  Meshy: "meshy",
  Uthana: "uthana",
  GptImage: "gpt-image",
  NanoBanana: "nano-banana",
  MiniMax: "minimax",
  Blender: "blender",
  ElevenLabs: "elevenlabs",
  Publishing: "publishing",
} as const;
export type RoutedTool = (typeof RoutedTool)[keyof typeof RoutedTool];

/** Each tool's mark, a file the app ships; light marks drawn for a dark tile. */
const MARK: Record<RoutedTool, string> = {
  [RoutedTool.Tripo]: "media/tools/tripo.png",
  [RoutedTool.Meshy]: "media/tools/meshy.svg",
  [RoutedTool.Uthana]: "media/tools/uthana.png",
  [RoutedTool.GptImage]: "media/tools/openai.svg",
  [RoutedTool.NanoBanana]: "media/tools/gemini.svg",
  [RoutedTool.MiniMax]: "media/tools/minimax.svg",
  [RoutedTool.Blender]: "media/tools/blender.svg",
  [RoutedTool.ElevenLabs]: "media/tools/elevenlabs.svg",
  [RoutedTool.Publishing]: "media/tools/genex.svg",
};

/** The tools in the order the page lists them, each with its mark. */
export const ROUTED_TOOLS: ReadonlyArray<{ id: RoutedTool; mark: string }> = Object.values(RoutedTool).map((id) => ({
  id,
  mark: MARK[id],
}));

/** The eight tools the router's picture plays, in the order they first fill and then join the board. */
export const ICON_TOOLS: readonly RoutedTool[] = [
  RoutedTool.Tripo,
  RoutedTool.Meshy,
  RoutedTool.ElevenLabs,
  RoutedTool.GptImage,
  RoutedTool.Uthana,
  RoutedTool.NanoBanana,
  RoutedTool.MiniMax,
  RoutedTool.Blender,
];

/** A tool's mark. */
export const toolMark = (id: RoutedTool): string => MARK[id];

/** Every tool's name and what it does, checked to cover each tool. */
const COPY: Record<RoutedTool, { name: string; line: string }> = GENEX_WORDS.router.tools;

/** A tool's name and what it does, as the page lists it. */
export const toolCopy = (id: RoutedTool): { name: string; line: string } => COPY[id];
