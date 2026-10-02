export interface BuildPreviewRequest {
  runId: string;
  facetId: string;
  iteration: number;
}
export interface BuildPreviewFrame {
  path: string;
  capturedAt: string;
  camera: string;
}
