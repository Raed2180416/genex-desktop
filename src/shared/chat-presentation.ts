/** Older harness versions saved handoff diagnostics as assistant prose. Hide only the
 * recognisable host templates, never a model's ordinary explanation or error. */
export function isHandoffNarration(text: string): boolean {
  return /^(?:\*\*[^\n]+\*\* \(folder `[^`]+`\) — .+ conducts the (?:build|Loop) interview itself and starts the run when it has what it needs\.|.+ continues the (?:build|Loop|Autopilot) interview — same session, its context restored\.|Resuming the contractor in \*\*.+\*\* \(folder `[^`]+`\) — same chat, its context restored\.|(?:Handing this (?:back )?to the contractor in|Starting a new project) [\s\S]+works alone and can't ask questions mid-build, so it builds from this chat\.)/.test(
    text.trim(),
  );
}
