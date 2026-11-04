/**
 * Rendert ein Kamera-Videobild perspektivisch entzerrt in Wandkoordinaten (WebGL).
 * Da die Kamera fest steht, bildet die Homographie H (Kamera normalisiert → Wand 0..1) jedes Videobild exakt auf die Wandkarte ab.
 * Fragment-Shader: für jeden Wandpunkt (u,v) den Kamerapunkt H⁻¹·(u,v,1) abtasten.
 */
import { inv3, type Mat3 } from '../geometry/homography';

const VS = `attribute vec2 p; varying vec2 v; void main(){ v = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = vec4(p,0.0,1.0); }`;
const FS = `precision mediump float; varying vec2 v; uniform sampler2D tex; uniform mat3 hinv;
void main(){ vec3 q = hinv * vec3(v,1.0); vec2 uv = q.xy / q.z; if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0){ discard; } gl_FragColor = vec4(texture2D(tex, uv).rgb, 1.0); }`;

export class VideoWarp {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null;
  private tex: WebGLTexture | null = null;
  private loc: WebGLUniformLocation | null = null;
  private lastTime = -1;
  private hinvKey = '';
  ok = true;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas'); this.canvas.width = width; this.canvas.height = height;
    const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    this.gl = gl;
    if (!gl) { this.ok = false; return; }
    const sh = (t: number, src: string): WebGLShader => { const s = gl.createShader(t) as WebGLShader; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader-Fehler'); return s; };
    try {
      const pr = gl.createProgram() as WebGLProgram; gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      this.loc = gl.getUniformLocation(pr, 'hinv');
      this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.viewport(0, 0, width, height);
    } catch { this.ok = false; }
  }

  /** Zeichnet das aktuelle Videobild entzerrt. Gibt false zurück, wenn (noch) nichts gezeichnet werden kann. */
  render(video: HTMLVideoElement, h: Mat3): boolean {
    const gl = this.gl;
    if (!this.ok || !gl || !this.tex || video.readyState < 2 || !video.videoWidth) return false;
    const key = h.join(',');
    if (video.currentTime === this.lastTime && key === this.hinvKey) return true; // unverändert → gecachtes Bild bleibt stehen
    this.lastTime = video.currentTime; this.hinvKey = key;
    const hi = inv3(h);
    gl.uniformMatrix3fv(this.loc, false, new Float32Array([hi[0], hi[3], hi[6], hi[1], hi[4], hi[7], hi[2], hi[5], hi[8]])); // spaltenweise
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}
