import { memo, useMemo, useRef } from "react";
import type { ChatFileRef } from "../../shared/chat-files.ts";
import { answersOf, clickFileLink, useChatFileNames, useChatFiles } from "../chat-files.ts";
import { linkifyHtml } from "./file-links.ts";
import { highlightCode } from "./syntax-highlight.ts";

/** Highlighted code; inside a chat, the paths in it that are files become links. */
export const SyntaxCode = memo(function SyntaxCode({ text, language }: { text: string; language?: string }) {
  const { threadId, lookup } = useChatFiles();
  const highlighted = useMemo(() => highlightCode(text, language), [text, language]);
  // Only this code's own answers link it again (see Markdown.tsx).
  const shown = useRef<ChatFileRef[]>([]);
  const answered = answersOf(lookup, shown.current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `lookup` is read through `answered`, which changes exactly when this code's answers do
  const { html, names } = useMemo(() => {
    const found: ChatFileRef[] = [];
    return { html: threadId ? linkifyHtml(highlighted, lookup, found, true) : highlighted, names: found };
  }, [highlighted, threadId, answered]);
  shown.current = names;
  useChatFileNames(threadId, names);
  return (
    <code
      data-code-language={language}
      onClick={(event) => clickFileLink(event, threadId)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
