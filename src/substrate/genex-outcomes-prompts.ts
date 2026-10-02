/** What an asset inspection tells the agent to do next, depending on what it observed. */
export const USE_GUIDANCE = {
  AudioVerified:
    "Per-file non-silent media stream and advancing playback observed. This does not certify physical speaker output or downstream Web Audio routing.",
  AudioUnverified:
    "Audio playback is unverified. Inspect the per-file audio states; a screenshot or download does not establish playback.",
  VisualLoaded:
    "Inspect the attached frame. Only if the requested asset is visibly used, call verify_use with this job id, options.inspectionId and a specific observation in prompt.",
  NothingLoaded:
    "No delivered asset was observed loading in this running page. A saved file is not integration evidence.",
} as const;
