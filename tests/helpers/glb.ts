/** Tiny GLB files built in memory, for tests that need a model's header and nothing it draws. */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** A GLB 2 holding `doc` as its JSON chunk and `bin` (if any) as its binary chunk. */
export function glb(doc: unknown, bin: Uint8Array = new Uint8Array()): Buffer {
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const body = Buffer.concat([Buffer.from(bin), Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(GLB_MAGIC, 0);
  head.writeUInt32LE(2, 4);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(json.length, 0);
  jsonHead.writeUInt32LE(CHUNK_JSON, 4);
  const parts = [head, jsonHead, json];
  if (body.length) {
    const binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(body.length, 0);
    binHead.writeUInt32LE(CHUNK_BIN, 4);
    parts.push(binHead, body);
  }
  const file = Buffer.concat(parts);
  file.writeUInt32LE(file.length, 8);
  return file;
}

/**
 * An animation-only GLB, as Genex delivers a character's extra action: the rig's bones and one
 * clip turning `bones[0]`, with no mesh to draw.
 */
export function motionGlb(name: string, bones: readonly string[]): Buffer {
  const bin = new Uint8Array(40);
  const view = new DataView(bin.buffer);
  const times = [0, 1];
  const turns = [0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2];
  for (const [i, t] of times.entries()) view.setFloat32(i * 4, t, true);
  for (const [i, q] of turns.entries()) view.setFloat32(8 + i * 4, q, true);
  return glb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: bones.map((bone, i) => ({ name: bone, ...(i === 0 && bones.length > 1 ? { children: [1] } : {}) })),
      buffers: [{ byteLength: 40 }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 8 },
        { buffer: 0, byteOffset: 8, byteLength: 32 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
        { bufferView: 1, componentType: 5126, count: 2, type: "VEC4" },
      ],
      animations: [
        {
          name,
          channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
          samplers: [{ input: 0, output: 1 }],
        },
      ],
    },
    bin,
  );
}
