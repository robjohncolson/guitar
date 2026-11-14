import { MAX_PARTICLES, burstEnd, isEmpty, particle, type LightFrame, type Particle, type Shape } from './light';

/** A WebGL2 canvas that draws a LightFrame additively over the lane. All inputs are CSS px. */
export interface LightLayer {
  readonly canvas: HTMLCanvasElement;
  /** Draw a frame (nothing while there is no light). False once the context is lost. */
  draw(f: LightFrame, cssW: number, cssH: number): boolean;
  /** Re-draw the last frame and return the sum of the alpha channel over the whole backing store (a development check). */
  alpha(): number;
  lost(): boolean;
  /** Whether the shaders have finished compiling (they compile in the background where the browser can). Until then nothing is drawn. */
  ready(): boolean;
  dispose(): void;
}

const SHAPES = 256, SHAPE_FLOATS = 9, PART_FLOATS = 11, MARGIN = 2;
const KIND: Record<Shape['kind'], number> = { glow: 0, ring: 1, band: 2, line: 3 };

const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
const UNI = 'uniform vec2 uRes;\n';
/** CSS px (y down) to clip space. */
const CLIP = 'vec4 toClip(vec2 p) { return vec4(p.x / uRes.x * 2. - 1., 1. - p.y / uRes.y * 2., 0., 1.); }\n';

const SHAPE_VS = `${HEAD}${UNI}${CLIP}
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 iRect;
layout(location = 2) in vec3 iColour;
layout(location = 3) in float iAlpha;
layout(location = 4) in float iKind;
out vec2 vPos;
flat out vec4 vRect;
flat out vec3 vColour;
flat out float vAlpha;
flat out float vKind;
void main() {
  vec2 p = iRect.xy - ${MARGIN}. + aQuad * (iRect.zw + ${2 * MARGIN}.);
  vPos = p; vRect = iRect; vColour = iColour; vAlpha = iAlpha; vKind = iKind;
  gl_Position = toClip(p);
}`;

const CUT = `uniform vec4 uClip;
uniform vec4 uKeep[2];
uniform int uKeepN;
bool cut(vec2 p) {
  if (p.x < uClip.x || p.y < uClip.y || p.x > uClip.x + uClip.z || p.y > uClip.y + uClip.w) return true;
  for (int i = 0; i < 2; i++) {
    if (i >= uKeepN) break;
    vec4 k = uKeep[i];
    if (p.x >= k.x && p.y >= k.y && p.x <= k.x + k.z && p.y <= k.y + k.w) return true;
  }
  return false;
}
`;

const SHAPE_FS = `${HEAD}${CUT}
in vec2 vPos;
flat in vec4 vRect;
flat in vec3 vColour;
flat in float vAlpha;
flat in float vKind;
out vec4 outColour;
void main() {
  if (cut(vPos)) discard;
  vec2 c = vRect.xy + vRect.zw * .5;
  vec2 d = vPos - c;
  int kind = int(vKind + .5);
  float f = 0.;
  if (kind == 0) {
    float r = length(d) / (vRect.z * .5);
    f = r < .45 ? 1. - .55 * r / .45 : .45 * (1. - (r - .45) / .55);
    f = clamp(f, 0., 1.);
  } else if (kind == 1) {
    float e = abs(length(d) - vRect.z * .5);
    f = d.y < 0. ? 1. - smoothstep(.5, 1.5, e) : 0.;
  } else if (kind == 2) {
    bool inside = vPos.x >= vRect.x && vPos.x <= vRect.x + vRect.z && vPos.y >= vRect.y && vPos.y <= vRect.y + vRect.w;
    f = inside ? clamp((vPos.y - vRect.y) / vRect.w, 0., 1.) : 0.;
  } else {
    bool inside = vPos.x >= vRect.x && vPos.x <= vRect.x + vRect.z;
    f = inside ? 1. - smoothstep(0., 1., abs(d.y) / (vRect.w * .5)) : 0.;
  }
  float a = clamp(vAlpha * f, 0., 1.);
  outColour = vec4(vColour * a, a);
}`;

const PART_VS = `${HEAD}${UNI}${CLIP}uniform float uTime;
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec2 iStart;
layout(location = 2) in vec2 iVel;
layout(location = 3) in float iBirth;
layout(location = 4) in float iLife;
layout(location = 5) in float iSize;
layout(location = 6) in float iSoft;
layout(location = 7) in vec3 iColour;
out vec2 vPos;
out vec2 vLocal;
flat out vec3 vColour;
flat out float vAlpha;
flat out float vSoft;
void main() {
  float t = uTime - iBirth;
  if (t < 0. || t >= iLife) { gl_Position = vec4(2., 2., 0., 1.); vPos = vec2(0.); vLocal = vec2(0.); vColour = vec3(0.); vAlpha = 0.; vSoft = 0.; return; }
  vec2 pos = iStart + iVel * t + vec2(0., 45. * t * t);
  float half_ = iSize * (iSoft > .5 ? 1. : 2.5);
  vLocal = aQuad * 2. - 1.;
  vPos = pos + vLocal * half_;
  vColour = iColour; vSoft = iSoft;
  vAlpha = (1. - t / iLife) * (iSoft > .5 ? .5 : 1.);
  gl_Position = toClip(vPos);
}`;

const PART_FS = `${HEAD}${CUT}
in vec2 vPos;
in vec2 vLocal;
flat in vec3 vColour;
flat in float vAlpha;
flat in float vSoft;
out vec4 outColour;
void main() {
  if (cut(vPos)) discard;
  float r = length(vLocal);
  float f;
  if (vSoft > .5) f = 1. - smoothstep(0., 1., r);
  else f = (exp(-r * r * 18.) + .3 * exp(-r * r * 4.)) * (1. - smoothstep(.7, 1., r));
  float a = clamp(vAlpha * f, 0., 1.);
  outColour = vec4(vColour * a, a);
}`;

/** Starts compiling and linking a program; its status is asked only once it is done, so the page never waits on it. */
function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs), p = gl.createProgram()!;
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  return p;
}

/**
 * The WebGL2 light layer appended to host, or undefined when WebGL2 is unavailable. Unless forced, a software-only
 * WebGL (a major performance caveat, or a software renderer such as SwiftShader) counts as unavailable: the 2D light is cheaper there.
 */
export function glLight(host: HTMLElement, onLost: () => void, force = false): LightLayer | undefined {
  const canvas = document.createElement('canvas');
  canvas.className = 'piece-light';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: !force });
  const info = gl?.getExtension('WEBGL_debug_renderer_info'), renderer = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  if (!gl || (!force && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer))) { gl?.getExtension('WEBGL_lose_context')?.loseContext(); canvas.remove(); return undefined; }
  const sp = program(gl, SHAPE_VS, SHAPE_FS), pp = program(gl, PART_VS, PART_FS), parallel = gl.getExtension('KHR_parallel_shader_compile');

  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  /** A VAO over the unit quad plus one instance buffer: floats per instance, then [location, size, offset] per attribute. */
  const vao = (floats: number, size: number, attrs: [number, number, number][]) => {
    const a = gl.createVertexArray()!, b = gl.createBuffer()!;
    gl.bindVertexArray(a);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, size * floats * 4, gl.DYNAMIC_DRAW);
    for (const [loc, n, off] of attrs) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, floats * 4, off * 4); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
    return { a, b };
  };
  const shapeV = vao(SHAPE_FLOATS, SHAPES, [[1, 4, 0], [2, 3, 4], [3, 1, 7], [4, 1, 8]]);
  const partV = vao(PART_FLOATS, MAX_PARTICLES, [[1, 2, 0], [2, 2, 2], [3, 1, 4], [4, 1, 5], [5, 1, 6], [6, 1, 7], [7, 3, 8]]);
  const uni = (p: WebGLProgram) => ({ res: gl.getUniformLocation(p, 'uRes'), clip: gl.getUniformLocation(p, 'uClip'), keep: gl.getUniformLocation(p, 'uKeep'), keepN: gl.getUniformLocation(p, 'uKeepN'), time: gl.getUniformLocation(p, 'uTime') });
  let su: ReturnType<typeof uni> | undefined, pu: ReturnType<typeof uni> | undefined;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  const shapeData = new Float32Array(SHAPES * SHAPE_FLOATS), partData = new Float32Array(MAX_PARTICLES * PART_FLOATS), keepData = new Float32Array(8);
  const scratch: Particle = { x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0 };
  /** Uploaded bursts: the frame that last listed each one and when it ends. */
  const seen = new Map<number, { no: number; end: number }>();
  let frameNo = 0, head = 0, filled = 0, t0 = NaN, backW = 0, backH = 0, lostFlag = false, prevEmpty = true, drawn = false, last: LightFrame | undefined, lastW = 0, lastH = 0, pixels: Uint8Array | undefined;

  const onContextLost = (e: Event) => { e.preventDefault(); if (!lostFlag) { lostFlag = true; onLost(); } };
  /** Whether both programs are linked and their uniforms found; a failed link counts as a lost context. */
  function linked(): boolean {
    if (su) return true;
    if (lostFlag) return false;
    if (parallel && !(gl!.getProgramParameter(sp, parallel.COMPLETION_STATUS_KHR) && gl!.getProgramParameter(pp, parallel.COMPLETION_STATUS_KHR))) return false;
    if (!gl!.getProgramParameter(sp, gl!.LINK_STATUS) || !gl!.getProgramParameter(pp, gl!.LINK_STATUS)) { lostFlag = true; onLost(); return false; }
    su = uni(sp); pu = uni(pp);
    return true;
  }
  canvas.addEventListener('webglcontextlost', onContextLost);

  /** Write a burst's particles into the ring and upload them. */
  function upload(b: LightFrame['bursts'][number]): void {
    if (Number.isNaN(t0)) t0 = b.at;
    const n = Math.min(b.count, MAX_PARTICLES), birth = (b.at - t0) / 1000;
    for (let i = 0; i < n; i++) {
      const p = particle(b, i, scratch), o = i * PART_FLOATS;
      partData[o] = p.x; partData[o + 1] = p.y; partData[o + 2] = p.vx; partData[o + 3] = p.vy;
      partData[o + 4] = birth; partData[o + 5] = p.life; partData[o + 6] = p.size; partData[o + 7] = b.soft ? 1 : 0;
      partData[o + 8] = b.colour[0]; partData[o + 9] = b.colour[1]; partData[o + 10] = b.colour[2];
    }
    gl!.bindBuffer(gl!.ARRAY_BUFFER, partV.b);
    const first = Math.min(n, MAX_PARTICLES - head);
    gl!.bufferSubData(gl!.ARRAY_BUFFER, head * PART_FLOATS * 4, partData, 0, first * PART_FLOATS);
    if (first < n) gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, partData, first * PART_FLOATS, (n - first) * PART_FLOATS);
    head = (head + n) % MAX_PARTICLES;
    filled = Math.min(MAX_PARTICLES, filled + n);
  }

  function paint(f: LightFrame, cssW: number, cssH: number): void {
    const g = gl!, su_ = su!, pu_ = pu!, dpr = Math.min(2, window.devicePixelRatio || 1), bw = Math.max(1, Math.round(cssW * dpr)), bh = Math.max(1, Math.round(cssH * dpr));
    if (bw !== backW || bh !== backH) {
      backW = canvas.width = bw; backH = canvas.height = bh;
      canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    }
    g.viewport(0, 0, bw, bh);
    g.clear(g.COLOR_BUFFER_BIT);

    // A burst dropped from the list before it ended (calm look, a microphone take, the take cap) must stop at once,
    // so the ring is rebuilt from the bursts still listed. Bursts that ended on their own need nothing.
    frameNo++;
    let dropped = false;
    for (const b of f.bursts) { const e = seen.get(b.id); if (e) e.no = frameNo; }
    for (const [id, e] of seen) if (e.no !== frameNo) { if (f.now < e.end) dropped = true; seen.delete(id); }
    if (dropped || f.bursts.length === 0) { seen.clear(); head = 0; filled = 0; t0 = NaN; }
    for (const b of f.bursts) if (!seen.has(b.id)) { upload(b); seen.set(b.id, { no: frameNo, end: burstEnd(b) }); }

    keepData.fill(0);
    const kn = Math.min(2, f.keepOut.length);
    for (let i = 0; i < kn; i++) { const k = f.keepOut[i]; keepData[i * 4] = k.x; keepData[i * 4 + 1] = k.y; keepData[i * 4 + 2] = k.w; keepData[i * 4 + 3] = k.h; }
    const common = (u: typeof su_) => {
      g.uniform2f(u.res, cssW, cssH);
      g.uniform4f(u.clip, f.clip.x, f.clip.y, f.clip.w, f.clip.h);
      g.uniform4fv(u.keep, keepData);
      g.uniform1i(u.keepN, kn);
    };

    const ns = Math.min(f.shapes.length, SHAPES);
    if (ns > 0) {
      for (let i = 0; i < ns; i++) {
        const s = f.shapes[i], o = i * SHAPE_FLOATS;
        shapeData[o] = s.x; shapeData[o + 1] = s.y; shapeData[o + 2] = s.w; shapeData[o + 3] = s.h;
        shapeData[o + 4] = s.colour[0]; shapeData[o + 5] = s.colour[1]; shapeData[o + 6] = s.colour[2];
        shapeData[o + 7] = s.a; shapeData[o + 8] = KIND[s.kind];
      }
      g.useProgram(sp); common(su_);
      g.bindVertexArray(shapeV.a);
      g.bindBuffer(g.ARRAY_BUFFER, shapeV.b);
      g.bufferSubData(g.ARRAY_BUFFER, 0, shapeData, 0, ns * SHAPE_FLOATS);
      g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, ns);
    }
    if (filled > 0) {
      g.useProgram(pp); common(pu_);
      g.uniform1f(pu_.time, (f.now - t0) / 1000);
      g.bindVertexArray(partV.a);
      g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, filled);
    }
    g.bindVertexArray(null);
  }

  const layer: LightLayer = {
    canvas,
    draw(f, cssW, cssH) {
      if (lostFlag) return false;
      if (!linked()) return true;
      last = f; lastW = cssW; lastH = cssH;
      const empty = isEmpty(f);
      if (empty && prevEmpty && drawn) return true;
      paint(f, cssW, cssH);
      prevEmpty = empty; drawn = true;
      return true;
    },
    alpha() {
      if (lostFlag || !last || !linked()) return 0;
      paint(last, lastW, lastH);
      const n = backW * backH * 4;
      if (!pixels || pixels.length !== n) pixels = new Uint8Array(n);
      gl.readPixels(0, 0, backW, backH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0;
      for (let i = 3; i < n; i += 4) sum += pixels[i];
      return sum;
    },
    lost: () => lostFlag,
    ready: linked,
    dispose() {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      gl.deleteBuffer(quad); gl.deleteBuffer(shapeV.b); gl.deleteBuffer(partV.b);
      gl.deleteVertexArray(shapeV.a); gl.deleteVertexArray(partV.a);
      gl.deleteProgram(sp); gl.deleteProgram(pp);
      canvas.remove();
    },
  };
  return layer;
}
