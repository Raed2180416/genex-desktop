/** Binary preview payloads already arrive as structured-cloned bytes. */
export function previewBytes(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return data;
}
