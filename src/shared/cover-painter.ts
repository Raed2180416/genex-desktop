/** Self-contained browser function: also serialized into the host's sandboxed cover validator. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: serialized whole into the host's sandboxed cover validator, so its helpers must live inside it.
export function createCoverPainter(canvas: HTMLCanvasElement, vertexSource: string) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) throw new Error("GPU cover rendering is unavailable.");
  const programs = new Set<WebGLProgram>();
  function shader(type: number, source: string) {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      const error = gl!.getShaderInfoLog(shader);
      gl!.deleteShader(shader);
      throw new Error(`Cover shader did not compile: ${error}`);
    }
    return shader;
  }
  const vertex = shader(gl.VERTEX_SHADER, vertexSource);
  /** A float, vec2 or vec3 uniform, by its length. */
  const setUniform = (location: WebGLUniformLocation | null, value: number | number[]) => {
    if (typeof value === "number") gl.uniform1f(location, value);
    else if (value.length === 2) gl.uniform2fv(location, value);
    else gl.uniform3fv(location, value);
  };
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  /**
   * Starts compiling and linking without waiting. Where the driver compiles in the background
   * (KHR_parallel_shader_compile), `ready()` turns true once `finish()` no longer blocks the page;
   * elsewhere it is always true. `finish()` checks the result and returns the drawable program.
   */
  const begin = (fragmentSource: string) => {
    const parallel = gl.getExtension("KHR_parallel_shader_compile");
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!fragment || !program) throw new Error("GPU cover rendering is unavailable.");
    gl.shaderSource(fragment, fragmentSource);
    gl.compileShader(fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    return {
      ready: () => !parallel || gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR) === true,
      finish() {
        const compiled = gl.getShaderParameter(fragment, gl.COMPILE_STATUS);
        const compileError = compiled ? "" : gl.getShaderInfoLog(fragment);
        gl.deleteShader(fragment);
        if (!compiled) {
          gl.deleteProgram(program);
          throw new Error(`Cover shader did not compile: ${compileError}`);
        }
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          const error = gl.getProgramInfoLog(program);
          gl.deleteProgram(program);
          throw new Error(`Cover shader did not link: ${error}`);
        }
        programs.add(program);
        return {
          program,
          position: gl.getAttribLocation(program, "position"),
          time: gl.getUniformLocation(program, "u_time"),
          seed: gl.getUniformLocation(program, "u_seed"),
          uniforms: new Map<string, WebGLUniformLocation | null>(),
        };
      },
    };
  };
  return {
    begin,
    compile(fragmentSource: string) {
      return begin(fragmentSource).finish();
    },
    /** Draws into the lower-left `size` square; extra uniforms are floats, vec2s or vec3s. */
    draw(
      compiled: {
        program: WebGLProgram;
        position: number;
        time: WebGLUniformLocation | null;
        seed: WebGLUniformLocation | null;
        uniforms?: Map<string, WebGLUniformLocation | null>;
      },
      time: number,
      seed: number,
      size = canvas.width,
      uniforms?: Record<string, number | number[]>,
    ) {
      if (gl.isContextLost()) throw new Error("Cover GPU context was lost.");
      gl.viewport(0, 0, size, size);
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
      gl.useProgram(compiled.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(compiled.position);
      gl.vertexAttribPointer(compiled.position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(compiled.time, time);
      gl.uniform1f(compiled.seed, seed);
      for (const [name, value] of Object.entries(uniforms ?? {})) {
        const locations = compiled.uniforms ?? new Map();
        if (!locations.has(name)) locations.set(name, gl.getUniformLocation(compiled.program, name));
        setUniform(locations.get(name) ?? null, value);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    remove(program: WebGLProgram) {
      gl.deleteProgram(program);
      programs.delete(program);
    },
    dispose() {
      for (const program of programs) gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteBuffer(buffer);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
