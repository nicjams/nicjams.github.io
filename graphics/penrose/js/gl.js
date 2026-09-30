/* ------------------------------------------------------------------ *
 *  WebGL2 quad renderer. Every rhombus (or morphing quad) is one
 *  instance carrying its four corners, colors and flags; the fragment
 *  shader draws the fill, the edge line, and the decorations (ribbon
 *  midlines, matching arcs, bevel light) from exact distances, so lines
 *  stay crisp at every zoom and tiles can deform freely mid-flip.
 *
 *  Instance layout (FLOATS per instance):
 *    c01  : corner0.xy, corner1.xy        (world, relative to view center)
 *    c23  : corner2.xy, corner3.xy
 *    fill : r, g, b, alpha
 *    line : r, g, b, alpha
 *    meta : glow, famA + 8·famB, bits, line-width multiplier
 *  bits: 1 fat · 2 arcs swapped · 4 ribbon A lit · 8 ribbon B lit
 *        16 hovered · 32 no decorations (ghosts)
 * ------------------------------------------------------------------ */

export const FLOATS = 20;

const VS = `#version 300 es
in vec4 a_c01; in vec4 a_c23; in vec4 a_fill; in vec4 a_line; in vec4 a_meta;
uniform vec2 u_res; uniform float u_ppw; uniform vec2 u_rot;
out vec2 v_w;
flat out vec4 v_c01; flat out vec4 v_c23; flat out vec4 v_fill; flat out vec4 v_line; flat out vec4 v_meta;
void main() {
  int id = gl_VertexID;
  vec2 p = id == 0 ? a_c01.xy : id == 1 ? a_c01.zw : id == 2 ? a_c23.zw : a_c23.xy;
  v_w = p;
  v_c01 = a_c01; v_c23 = a_c23; v_fill = a_fill; v_line = a_line; v_meta = a_meta;
  vec2 r = vec2(u_rot.x * p.x - u_rot.y * p.y, u_rot.y * p.x + u_rot.x * p.y) * u_ppw;
  gl_Position = vec4(r / (0.5 * u_res), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v_w;
flat in vec4 v_c01; flat in vec4 v_c23; flat in vec4 v_fill; flat in vec4 v_line; flat in vec4 v_meta;
uniform float u_ppw; uniform vec2 u_rot;
uniform int u_style;
uniform float u_lw, u_fillMul, u_lineMul;
uniform vec3 u_fam[5];
uniform float u_ribbons, u_mw;
uniform float u_arcs, u_aw; uniform vec3 u_arcR; uniform vec3 u_arc0, u_arc1;
uniform vec3 u_glow, u_grout, u_bg, u_hl;
uniform float u_hasHL, u_light;
out vec4 o;

float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float cover(float d, float hw) { return 1.0 - smoothstep(hw - 0.55, hw + 0.55, d); }

void main() {
  vec2 c0 = v_c01.xy, c1 = v_c01.zw, c2 = v_c23.xy, c3 = v_c23.zw;
  vec2 p = v_w;
  float e0 = seg(p, c0, c1), e1 = seg(p, c1, c2), e2 = seg(p, c2, c3), e3 = seg(p, c3, c0);
  float dw = min(min(e0, e1), min(e2, e3));
  float d = dw * u_ppw;
  int bits = int(v_meta.z + 0.5);
  bool fat = (bits & 1) != 0;
  bool plain = (bits & 32) != 0;
  vec3 col = v_fill.rgb;

  if (u_style == 1) {                       // grout: glazed ceramic
    float t = clamp(dw / 0.32, 0.0, 1.0);
    col *= mix(0.86, 1.05, sqrt(t));
  } else if (u_style == 2) {                // bevel: raised tiles lit from the upper left
    vec2 a = c0, b = c1; float de = e0;
    if (e1 < de) { a = c1; b = c2; de = e1; }
    if (e2 < de) { a = c2; b = c3; de = e2; }
    if (e3 < de) { a = c3; b = c0; de = e3; }
    vec2 m = 0.25 * (c0 + c1 + c2 + c3);
    vec2 n = normalize(vec2(-(b - a).y, (b - a).x));
    if (dot(n, m - a) < 0.0) n = -n;
    vec2 ns = vec2(u_rot.x * n.x - u_rot.y * n.y, u_rot.y * n.x + u_rot.x * n.y);
    float k = clamp(1.0 - de / 0.11, 0.0, 1.0);
    float lit = dot(-ns, normalize(vec2(-0.62, 0.78)));
    col = clamp(col + k * k * lit * 0.34 * u_light, 0.0, 1.0);
    col *= mix(0.97, 1.03, clamp(dw / 0.3, 0.0, 1.0));
  } else if (u_style == 3) {                // line art
    col = mix(u_bg, col, u_light < 0.9 ? 0.22 : 0.12);
  }

  col = mix(col, u_glow, v_meta.x * 0.6);
  bool lit = (bits & 12) != 0;
  if (lit) col = mix(col, u_hl, 0.16);
  else if (u_hasHL > 0.5) col = mix(col, u_bg, 0.3);

  if (!plain && u_arcs > 0.5) {
    bool swap = (bits & 2) != 0;
    float r0 = fat ? u_arcR.x : u_arcR.y;
    vec2 cA = swap ? c2 : c0, cB = swap ? c0 : c2;
    float dA = abs(length(p - cA) - r0) * u_ppw;
    float dB = abs(length(p - cB) - u_arcR.z) * u_ppw;
    col = mix(col, u_arc0, cover(dA, u_aw));
    col = mix(col, u_arc1, cover(dB, u_aw));
  }

  if (!plain && (u_ribbons > 0.5 || lit)) {
    int fam = int(v_meta.y + 0.5);
    int fA = fam - (fam / 8) * 8, fB = fam / 8;
    bool litA = (bits & 4) != 0, litB = (bits & 8) != 0;
    float dA = seg(p, 0.5 * (c0 + c1), 0.5 * (c3 + c2)) * u_ppw;
    float dB = seg(p, 0.5 * (c0 + c3), 0.5 * (c1 + c2)) * u_ppw;
    if (u_ribbons > 0.5 || litA) {
      vec3 fc = litA ? mix(u_fam[fA], vec3(1.0), 0.25) : u_fam[fA];
      col = mix(col, fc, cover(dA, u_mw * (litA ? 2.0 : 1.0)) * (u_hasHL > 0.5 && !litA ? 0.45 : 1.0));
    }
    if (u_ribbons > 0.5 || litB) {
      vec3 fc = litB ? mix(u_fam[fB], vec3(1.0), 0.25) : u_fam[fB];
      col = mix(col, fc, cover(dB, u_mw * (litB ? 2.0 : 1.0)) * (u_hasHL > 0.5 && !litB ? 0.45 : 1.0));
    }
  }

  float fa = v_fill.a * u_fillMul;
  vec3 lc = u_style == 1 ? u_grout : v_line.rgb;
  if (u_style == 3) lc = u_light < 0.9 ? v_line.rgb : mix(v_fill.rgb, vec3(1.0), 0.35) * 1.15;
  float hw = u_lw * v_meta.w;
  if ((bits & 16) != 0) { lc = u_hl; hw = max(hw * 2.6, 1.6); }
  float la = v_line.a * u_lineMul * cover(d, hw);
  vec4 F = vec4(col * fa, fa);
  o = vec4(lc * la, la) + F * (1.0 - la);
}`;

export class GLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl2', {
            antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true,
        });
        this.ok = !!gl;
        if (!gl) return;
        this.gl = gl;
        const prog = gl.createProgram();
        for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                console.error(gl.getShaderInfoLog(sh));
                this.ok = false;
                return;
            }
            gl.attachShader(prog, sh);
        }
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(prog));
            this.ok = false;
            return;
        }
        this.prog = prog;
        gl.useProgram(prog);
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        this.buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        const names = ['a_c01', 'a_c23', 'a_fill', 'a_line', 'a_meta'];
        names.forEach((n, i) => {
            const loc = gl.getAttribLocation(prog, n);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
            gl.vertexAttribDivisor(loc, 1);
        });
        this.u = {};
        const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) {
            const info = gl.getActiveUniform(prog, i);
            const name = info.name.replace(/\[0\]$/, '');
            this.u[name] = gl.getUniformLocation(prog, info.name);
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.bufCap = 0;
    }

    resize(w, h) {
        const gl = this.gl;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(this.u.u_res, w, h);
    }

    clear() {
        const gl = this.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    /** Frame-wide uniforms. */
    setFrame(f) {
        const gl = this.gl, u = this.u;
        gl.uniform1f(u.u_ppw, f.ppw);
        gl.uniform2f(u.u_rot, Math.cos(f.angle), Math.sin(f.angle));
        gl.uniform1i(u.u_style, f.style);
        gl.uniform1f(u.u_lw, f.lw);
        gl.uniform3fv(u.u_fam, f.fam);
        gl.uniform1f(u.u_ribbons, f.ribbons ? 1 : 0);
        gl.uniform1f(u.u_mw, f.mw);
        gl.uniform1f(u.u_arcs, f.arcs ? 1 : 0);
        gl.uniform1f(u.u_aw, f.aw);
        gl.uniform3fv(u.u_arcR, f.arcR);
        gl.uniform3fv(u.u_arc0, f.arc0);
        gl.uniform3fv(u.u_arc1, f.arc1);
        gl.uniform3fv(u.u_glow, f.glow);
        gl.uniform3fv(u.u_grout, f.grout);
        gl.uniform3fv(u.u_bg, f.bg);
        gl.uniform3fv(u.u_hl, f.hl);
        gl.uniform1f(u.u_hasHL, f.hasHL ? 1 : 0);
        gl.uniform1f(u.u_light, f.light);
    }

    draw(data, count, fillMul = 1, lineMul = 1) {
        if (!count) return;
        const gl = this.gl;
        gl.uniform1f(this.u.u_fillMul, fillMul);
        gl.uniform1f(this.u.u_lineMul, lineMul);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        const bytes = count * FLOATS * 4;
        if (bytes > this.bufCap) {
            this.bufCap = Math.max(bytes, this.bufCap * 2);
            gl.bufferData(gl.ARRAY_BUFFER, this.bufCap, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * FLOATS);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
}

/* Canvas 2D fallback for browsers without WebGL2: fills and edges only. */
export class CanvasRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.ok = !!this.ctx;
    }
    resize(w, h) { this.w = w; this.h = h; }
    clear() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.w, this.h); }
    setFrame(f) { this.f = f; }
    draw(data, count, fillMul = 1, lineMul = 1) {
        const ctx = this.ctx, f = this.f;
        const c = Math.cos(f.angle) * f.ppw, s = Math.sin(f.angle) * f.ppw;
        ctx.setTransform(c, -s, -s, -c, this.w / 2, this.h / 2);
        ctx.lineJoin = 'round';
        ctx.lineWidth = (2 * f.lw) / f.ppw;
        const hex = (r, g, b) => `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})`;
        for (let i = 0; i < count; i++) {
            const o = i * FLOATS;
            ctx.beginPath();
            ctx.moveTo(data[o], data[o + 1]);
            ctx.lineTo(data[o + 2], data[o + 3]);
            ctx.lineTo(data[o + 4], data[o + 5]);
            ctx.lineTo(data[o + 6], data[o + 7]);
            ctx.closePath();
            const fa = data[o + 11] * fillMul, la = data[o + 15] * lineMul;
            if (fa > 0.003) {
                ctx.globalAlpha = fa;
                ctx.fillStyle = hex(data[o + 8], data[o + 9], data[o + 10]);
                ctx.fill();
            }
            if (la > 0.003) {
                ctx.globalAlpha = la;
                ctx.strokeStyle = hex(data[o + 12], data[o + 13], data[o + 14]);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }
}
