import { glassPatternValue, type GlassPattern } from "./glass-patterns";

/** Adapts this repository's V4 procedural optics to live DOM pane geometry.
 * Only the background is refracted; text and chart pixels never enter WebGL. */
const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

const lightSource = `
    precision highp float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform float u_lightTheme;
    uniform float u_pattern;

    float band(float d, float width) {
      float v = d / width;
      return exp(-v * v);
    }

    // Studio reflections on curved sheets. Broad lights and black negative
    // space are modeled separately; no artwork or remote texture is sampled.
    vec3 silverReflection(vec3 normal, vec2 q, float t) {
      vec3 view = vec3(0.0, 0.0, 1.0);
      vec3 reflected = reflect(-view, normalize(normal));
      float box = exp(-pow((reflected.y - 0.20) / 0.42, 2.0));
      float strip = exp(-pow((reflected.y + 0.56) / 0.065, 2.0));
      float side = exp(-pow((reflected.x - 0.55) / 0.26, 2.0));
      float shade = 0.14 + 0.86 * smoothstep(-0.75, 0.55, reflected.x);
      vec3 silver = vec3(0.018, 0.021, 0.025);
      silver += vec3(0.49, 0.51, 0.54) * box * shade;
      silver += vec3(0.80, 0.82, 0.84) * strip * (0.45 + 0.55 * side);
      silver += vec3(0.14, 0.15, 0.17) * side;
      float edge = pow(1.0 - max(0.0, normal.z), 4.0);
      silver += edge * mix(vec3(0.045, 0.060, 0.090), vec3(0.085, 0.068, 0.042),
                           0.5 + 0.5 * sin(q.x * 2.2 + t * 0.025));
      return silver;
    }

    vec4 silverSheet(vec2 q, float layer, float t) {
      float angle = layer == 0.0 ? -0.22 : (layer == 1.0 ? 0.40 : -0.48);
      q = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * q;
      float offset = layer == 0.0 ? 0.10 : (layer == 1.0 ? -0.21 : 0.38);
      float bend = 0.18 * sin(q.x * 3.0 + layer * 1.4 + t * 0.035)
                 + 0.09 * sin(q.x * 5.1 - layer * 0.7);
      float derivative = 0.54 * cos(q.x * 3.0 + layer * 1.4 + t * 0.035)
                       + 0.459 * cos(q.x * 5.1 - layer * 0.7);
      float width = (layer == 0.0 ? 0.155 : 0.085)
                  * (0.62 + 0.38 * cos(q.x * 2.6 + layer));
      float cross = (q.y - bend - offset) / width;
      // Analytic edge falloff doubles as anti-aliasing once upscaled.
      float coverage = 1.0 - smoothstep(0.93, 1.03, abs(cross));
      float nz = sqrt(max(0.0001, 1.0 - cross * cross));
      vec3 normal = normalize(vec3(-derivative * 0.7 + q.x * 0.17, cross * 0.85, nz));
      vec3 silver = silverReflection(normal, q, t);
      float lip = exp(-pow((abs(cross) - 0.94) / 0.04, 2.0));
      silver += vec3(0.18, 0.19, 0.21) * lip * (0.45 + 0.55 * nz);
      coverage *= 1.0 - smoothstep(0.64, 1.22, abs(q.x));
      return vec4(silver, coverage);
    }

    void main() {
      vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
      float t = u_time * 1.8;
      vec2 p = (uv - 0.5) * vec2(1.45, 1.0);
      p.x += 0.065 * sin(p.y * 5.0 + t * 0.18);
      p.y += 0.025 * cos(p.x * 6.0 - t * 0.17);

      // Light travels behind the workspace; the reading surface remains quiet.
      float bend = 0.17 * sin(p.x * 3.8 + t * 0.18)
                 + 0.025 * sin(p.x * 8.0 - t * 0.12);
      float d = p.y - bend + 0.34;
      float lower = p.y - 0.49 + 0.12 * cos(p.x * 4.3 - t * 0.15);
      float vertical = p.x - 0.58 + 0.22 * sin(p.y * 3.4 + t * 0.16);
      vec3 color = mix(vec3(0.047, 0.085, 0.105), vec3(0.082, 0.112, 0.125), uv.y);
      vec2 glow = (uv - vec2(0.88, 0.20)) * vec2(1.2, 1.0);
      color += vec3(0.075, 0.10, 0.105) * exp(-dot(glow, glow) * 4.0);
      float readingMask = mix(0.38, 1.0, smoothstep(0.48, 0.96, uv.x));
      color += vec3(0.30, 0.16, 0.48) * band(d + 0.04, 0.095) * readingMask;
      color += vec3(0.68, 0.39, 0.24) * band(d, 0.025) * readingMask;
      color += vec3(0.42, 0.70, 0.78) * band(d - 0.018, 0.009) * readingMask;
      color += vec3(0.11, 0.17, 0.25) * band(d - 0.04, 0.04) * readingMask;
      color += vec3(0.30, 0.16, 0.48) * band(lower + 0.03, 0.075);
      color += vec3(0.34, 0.25, 0.19) * band(lower, 0.022);
      color += vec3(0.25, 0.37, 0.38) * band(lower - 0.015, 0.008);
      color += vec3(0.10, 0.18, 0.22) * band(vertical, 0.11);
      color += vec3(0.28, 0.33, 0.34) * band(vertical + 0.017, 0.008);
      color += vec3(0.13, 0.09, 0.20) * band(vertical - 0.02, 0.024);
      float middle = p.y - 0.12 * sin(p.x * 4.0 + t * 0.24) - 0.12 * cos(t * 0.19);
      color += vec3(0.23, 0.10, 0.36) * band(middle + 0.055, 0.12);
      color += vec3(0.12, 0.30, 0.37) * band(middle, 0.026);
      color += vec3(0.37, 0.26, 0.11) * band(middle - 0.033, 0.014);
      // Four preview candidates share the same glass sampling pass below.
      if (u_pattern > 0.5 && u_pattern < 1.5) {
        vec2 q = p * vec2(1.0, 1.3);
        float terrain = length(q - vec2(0.22, -0.08))
          + 0.13 * sin(q.x * 5.0 + q.y * 3.0 + t * 0.06)
          + 0.07 * cos(q.y * 7.0 - q.x * 2.0 - t * 0.04);
        float strata = sin(terrain * 36.0 - t * 0.12);
        float mineral = 0.5 + 0.5 * sin(terrain * 11.0 + 1.2);
        color = mix(vec3(0.07, 0.10, 0.14), vec3(0.26, 0.16, 0.32), mineral);
        color += vec3(0.27, 0.24, 0.37) * pow(0.5 + 0.5 * strata, 5.0);
        color += vec3(0.55, 0.33, 0.16) * pow(max(0.0, sin(terrain * 36.0 + 0.42 - t * 0.12)), 18.0);
        color += vec3(0.23, 0.42, 0.43) * pow(max(0.0, sin(terrain * 36.0 - 0.34 - t * 0.12)), 24.0);
      } else if (u_pattern > 1.5 && u_pattern < 2.5) {
        vec2 q = p * 4.6;
        q += vec2(sin(q.y * 1.7 + t * 0.11), cos(q.x * 1.3 - t * 0.08)) * 0.42;
        float wave = sin(q.x * 2.1 + q.y * 0.8 + t * 0.09)
          + sin(q.y * 2.6 - q.x * 0.6 - t * 0.10)
          + 0.6 * cos(q.x * 1.6 - q.y * 2.1 + t * 0.07);
        float caustic = exp(-abs(wave) * 8.0);
        float spread = exp(-abs(wave) * 1.6);
        color = mix(vec3(0.035, 0.115, 0.15), vec3(0.07, 0.24, 0.24), uv.y);
        color += vec3(0.12, 0.26, 0.25) * spread;
        color += vec3(0.36, 0.53, 0.43) * caustic * (0.6 + 0.4 * uv.x);
        color += vec3(0.04, 0.07, 0.13) * sin(q.x + q.y) * sin(q.y);
      } else if (u_pattern > 2.5 && u_pattern < 3.5) {
        float fold = p.x + 0.17 * sin(p.y * 2.8 + t * 0.08)
          + 0.045 * sin(p.y * 7.0 - t * 0.05);
        float curtain = 0.5 + 0.5 * sin(fold * 17.0 + t * 0.09);
        float silk = pow(curtain, 4.0);
        float fine = 0.5 + 0.5 * sin(fold * 78.0 + p.y * 1.8);
        color = vec3(0.035, 0.085, 0.12);
        color += mix(vec3(0.04, 0.30, 0.23), vec3(0.20, 0.13, 0.37), uv.x)
          * silk * (0.65 + 0.35 * cos(p.y * 1.6));
        color += vec3(0.19, 0.34, 0.30) * pow(curtain, 15.0) * (0.75 + fine * 0.25);
        color += vec3(0.025, 0.05, 0.045) * curtain;
      } else if (u_pattern > 3.5 && u_pattern < 4.5) {
        float r1 = length((p - vec2(0.27, 0.02)) * vec2(1.0, 1.1));
        float r2 = length((p - vec2(-0.43, 0.28)) * vec2(1.0, 1.2));
        float ripple = 0.5 + 0.5 * cos(r1 * 66.0 - t * 0.15);
        float echo = 0.5 + 0.5 * cos(r2 * 42.0 + t * 0.11);
        color = vec3(0.065, 0.105, 0.15);
        color += vec3(0.15, 0.23, 0.29) * pow(ripple, 8.0);
        color += vec3(0.18, 0.13, 0.22) * pow(echo, 10.0);
        color += vec3(0.26, 0.35, 0.33) * pow(ripple * echo, 6.0);
        color += vec3(0.09, 0.07, 0.04) * exp(-r1 * 2.0);
      }
      if (u_pattern > 4.5) {
        vec2 q = (uv - 0.5) * vec2(1.65, 1.0);
        q.y += 0.025 * sin(t * 0.025);
        color = vec3(0.012, 0.015, 0.019);
        color += vec3(0.009, 0.010, 0.012) * exp(-dot(q, q) * 2.0);
        vec4 back = silverSheet(q, 2.0, t);
        color = mix(color, back.rgb, back.a);
        vec4 middleSheet = silverSheet(q, 1.0, t);
        color = mix(color, middleSheet.rgb, middleSheet.a);
        vec4 front = silverSheet(q, 0.0, t);
        color = mix(color, front.rgb, front.a);
      }
      vec3 lightBase = u_pattern > 4.5 ? vec3(0.79, 0.80, 0.81) : vec3(0.72, 0.79, 0.77);
      color = mix(color, lightBase + color * 0.30, u_lightTheme);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

const glassSource = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_light;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_lightTheme;
    uniform float u_pattern;
    uniform vec4 u_rects[12];
    uniform vec4 u_materials[12];
    uniform vec4 u_reliefRects[12];
    uniform vec4 u_reliefMaterials[12];

    float roundedRect(vec2 p, vec4 rect, float radius) {
      vec2 halfSize = rect.zw * 0.5;
      vec2 q = abs(p - rect.xy - halfSize) - halfSize + radius;
      return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
    }

    vec3 lightAt(vec2 pixel) {
      vec2 uv = pixel / u_resolution;
      return texture2D(u_light, vec2(uv.x, 1.0 - uv.y)).rgb;
    }

    void main() {
      vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;
      float distanceToGlass = 10000.0;
      vec4 pane = vec4(0.0);
      vec4 material = vec4(18.0, 0.0, 0.0, 1.0);
      for (int i = 0; i < 12; i++) {
        float distance = roundedRect(p, u_rects[i], u_materials[i].x);
        if (u_rects[i].z > 0.0 && distance < 0.0) {
          distanceToGlass = distance;
          pane = u_rects[i];
          material = u_materials[i];
        }
      }

      float smoke = step(4.5, u_pattern);
      vec3 color = lightAt(p);
      if (distanceToGlass < 0.0) {
        vec2 local = p - pane.xy;
        float radius = material.x;
        float frost = material.y;
        float edge = 1.0 - smoothstep(1.0, 22.0, -distanceToGlass);
        vec2 normal = normalize(vec2(
          roundedRect(p + vec2(0.7, 0.0), pane, radius)
            - roundedRect(p - vec2(0.7, 0.0), pane, radius),
          roundedRect(p + vec2(0.0, 0.7), pane, radius)
            - roundedRect(p - vec2(0.0, 0.7), pane, radius)
        ) + vec2(0.0001));

        // Selected controls emboss the existing outer surface, rather than
        // adding another pane (which could escape a scrolling DOM clip).
        float textureStrength = clamp(material.z, 0.0, 1.0);
        vec2 textureLocal = local;
        for (int i = 0; i < 12; i++) {
          if (u_reliefRects[i].z > 0.0) {
            float d = roundedRect(p, u_reliefRects[i], u_reliefMaterials[i].x);
            if (d < 0.0) {
              textureStrength = u_reliefMaterials[i].y * smoothstep(0.0, 2.0, -d);
              textureLocal = p - u_reliefRects[i].xy;
            }
          }
        }
        // Rounded, close-packed dimples: no drawn crossing lines. Each tiny
        // lens bends and shades the moving light beneath the sharp DOM text.
        vec2 diagonal = vec2(textureLocal.x + textureLocal.y, textureLocal.x - textureLocal.y) * 0.707107;
        vec2 cell = fract(diagonal / 5.5) - 0.5;
        float microlens = exp(-dot(cell, cell) * 14.0);
        vec2 slope = -cell * microlens * 9.5;
        vec2 facetNormal = vec2(slope.x + slope.y, slope.x - slope.y) * 0.707107;
        float facetHeight = microlens - 0.25;
        float flute = sin(local.x * 0.137 + sin(local.y * 0.014) * 0.6);
        vec2 textureNormal = vec2(cos(local.x * 0.137) * 1.2, flute * 0.3);
        textureNormal += facetNormal * textureStrength * 5.2;
        vec2 broadLens = vec2(sin(local.y * 0.019 + local.x * 0.004),
                              cos(local.x * 0.015 - local.y * 0.008));
        vec2 drift = vec2(2.2 * sin(u_time * 0.31 + local.y * 0.009),
                          1.4 * cos(u_time * 0.27 + local.x * 0.008));
        vec2 bend = -normal * edge * edge * 32.0
                  + textureNormal + broadLens * textureStrength * 13.0 + drift;
        float spectralWidth = (2.8 + edge * 10.0 + textureStrength * 1.6) * mix(1.0, 0.35, smoke);
        vec2 spectralDirection = normalize(normal * edge + vec2(0.7, 0.4));
        vec2 center = pane.xy + pane.zw * 0.5;
        vec2 refracted = center + (p - center) * (1.0 - textureStrength * 0.055) + bend;

        color = vec3(
          lightAt(refracted + spectralDirection * spectralWidth).r,
          lightAt(refracted).g,
          lightAt(refracted - spectralDirection * spectralWidth).b
        );
        if (frost > 0.2) {
          vec3 softened = lightAt(refracted) * 0.24
            + lightAt(refracted + vec2(16.0, 9.0)) * 0.19
            + lightAt(refracted + vec2(-16.0, -9.0)) * 0.19
            + lightAt(refracted + vec2(10.0, -18.0)) * 0.19
            + lightAt(refracted + vec2(-10.0, 18.0)) * 0.19;
          color = mix(color, softened, frost);
        }

        color = mix(color, mix(vec3(0.055, 0.095, 0.12), vec3(0.83, 0.88, 0.86), u_lightTheme), 0.12 + frost * 0.18);
        vec3 neutralFrost = mix(vec3(0.08, 0.09, 0.10), vec3(0.85, 0.86, 0.87), u_lightTheme);
        color = mix(color, neutralFrost, smoke * 0.12);
        float lightLevel = dot(color, vec3(0.21, 0.72, 0.07));
        // Facet shading is stationary and light-dependent, so the surface
        // reads as embossed glass instead of a moving noise overlay.
        float facetLight = dot(facetNormal, normalize(vec2(-0.65, -0.8)));
        float emboss = facetLight * (0.045 + min(lightLevel, 0.65) * 0.16);
        float facetSpecular = pow(max(0.0, facetLight), 7.0);
        vec3 coating = mix(vec3(0.76, 0.72, 0.95), vec3(0.32, 0.42, 0.48), u_lightTheme);
        color += textureStrength * coating * (emboss + facetSpecular * 0.035);
        color += textureStrength * facetHeight * vec3(0.006, 0.004, 0.010);
        color += (flute * 0.5 + 0.5) * vec3(0.003, 0.003, 0.008);

        float polished = exp(-abs(distanceToGlass + 1.7) * 1.4);
        float movingGlint = 0.5 + 0.5 * sin(local.x * 0.008 + local.y * 0.012 - u_time * 0.45);
        vec3 edgeColor = mix(vec3(0.49, 0.66, 1.0), vec3(1.0, 0.76, 0.59), movingGlint);
        edgeColor = mix(edgeColor, vec3(0.70, 0.73, 0.77), smoke);
        color += polished * edgeColor * (0.30 + movingGlint * 0.38);
        color += edge * edge * vec3(0.027, 0.020, 0.045);
        color = mix(lightAt(p), color, material.w);
      }

      // Subtle stationary dither prevents broad dark gradients from banding.
      float noise = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      color += (noise - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

type Playback = { animated: boolean; light: boolean; pattern?: GlassPattern };
type OpticalProgram = {
  handle: WebGLProgram;
  position: number;
  time: WebGLUniformLocation | null;
  theme: WebGLUniformLocation | null;
  pattern: WebGLUniformLocation | null;
};
export function createGlassOptics(canvas: HTMLCanvasElement, stage: HTMLElement) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;
  const programs: WebGLProgram[] = [];
  const buffers: WebGLBuffer[] = [];
  const textures: WebGLTexture[] = [];
  const framebuffers: WebGLFramebuffer[] = [];
  let frameId = 0;
  let disposed = false;
  let ready = false;
  let intersecting = true;
  let dirty = true;
  let checked = false;
  let textureAllocated = false;
  let phase = 2.4;
  let settleUntil = performance.now() + 1000;
  let previous = 0;
  let width = 1,
    height = 1,
    lightWidth = 1,
    lightHeight = 1;
  let options: Playback = { animated: false, light: false };
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let draw = () => {};
  const observedPanes = new Set<HTMLElement>();
  const canAnimate = () =>
    ready && options.animated && !document.hidden && intersecting && !gl.isContextLost();
  const cleanup = () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    intersectionObserver?.disconnect();
    stage.removeEventListener("scroll", geometryChanged, true);
    window.removeEventListener("scroll", geometryChanged);
    window.removeEventListener("resize", geometryChanged);
    document.removeEventListener("visibilitychange", sync);
    if (!gl.isContextLost()) {
      programs.forEach((p) => gl.deleteProgram(p));
      buffers.forEach((b) => gl.deleteBuffer(b));
      textures.forEach((t) => gl.deleteTexture(t));
      framebuffers.forEach((f) => gl.deleteFramebuffer(f));
    }
    delete stage.dataset.optics;
    delete stage.dataset.opticsError;
    delete stage.dataset.opticsPixel;
  };
  function tick(timestamp: number) {
    if (!gl || disposed || !ready || document.hidden || !intersecting || gl.isContextLost()) return;
    const animated = canAnimate();
    if (animated || timestamp < settleUntil) frameId = requestAnimationFrame(tick);
    // Decorative optics stay bounded at 24fps with a display-aware pixel budget.
    if (previous && timestamp - previous < 1000 / 24) return;
    if (previous && animated) phase += Math.min((timestamp - previous) / 1000, 0.15);
    previous = timestamp;
    if (timestamp < settleUntil) dirty = true;
    draw();
  }
  function sync() {
    if (disposed || !ready) return;
    cancelAnimationFrame(frameId);
    previous = 0;
    if (!document.hidden && intersecting) frameId = requestAnimationFrame(tick);
  }
  function geometryChanged() {
    dirty = true;
    settleUntil = performance.now() + 1000;
    // A paused material still follows scrolling and resized panes.
    if (!canAnimate()) sync();
  }
  try {
    const program = (source: string): OpticalProgram => {
      const compile = (type: number, text: string) => {
        const shader = gl.createShader(type);
        if (!shader) throw Error("Optics shader allocation failed");
        gl.shaderSource(shader, text);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          throw Error("Optics shader compilation failed");
        }
        return shader;
      };
      const handle = gl.createProgram();
      if (!handle) throw Error("Optics program allocation failed");
      programs.push(handle);
      const vertex = compile(gl.VERTEX_SHADER, vertexSource);
      let fragment: WebGLShader;
      try {
        fragment = compile(gl.FRAGMENT_SHADER, source);
      } catch (error) {
        gl.deleteShader(vertex);
        throw error;
      }
      gl.attachShader(handle, vertex);
      gl.attachShader(handle, fragment);
      gl.linkProgram(handle);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw Error("Optics link failed");
      return {
        handle,
        position: gl.getAttribLocation(handle, "a_position"),
        time: gl.getUniformLocation(handle, "u_time"),
        theme: gl.getUniformLocation(handle, "u_lightTheme"),
        pattern: gl.getUniformLocation(handle, "u_pattern"),
      };
    };
    const light = program(lightSource),
      glass = program(glassSource);
    const quad = gl.createBuffer();
    if (!quad) throw Error("Optics buffer allocation failed");
    buffers.push(quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const texture = gl.createTexture(),
      framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      throw Error("Optics light allocation failed");
    }
    textures.push(texture);
    framebuffers.push(framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const rects = new Float32Array(48),
      materials = new Float32Array(48);
    const rectLocation = gl.getUniformLocation(glass.handle, "u_rects[0]");
    const materialLocation = gl.getUniformLocation(glass.handle, "u_materials[0]");
    const reliefRects = new Float32Array(48),
      reliefMaterials = new Float32Array(48);
    const reliefRectLocation = gl.getUniformLocation(glass.handle, "u_reliefRects[0]");
    const reliefMaterialLocation = gl.getUniformLocation(glass.handle, "u_reliefMaterials[0]");
    const resolutionLocation = gl.getUniformLocation(glass.handle, "u_resolution");
    const textureLocation = gl.getUniformLocation(glass.handle, "u_light");
    const updateGeometry = () => {
      dirty = false;
      const bounds = stage.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      // Display-aware budget: HiDPI-crisp ribbons without unbounded fill rate.
      const deviceRatio = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(deviceRatio, 1800 / width, Math.sqrt(2_400_000 / (width * height)));
      const nextWidth = Math.round(width * scale),
        nextHeight = Math.round(height * scale);
      if (!textureAllocated || canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        lightWidth = nextWidth;
        lightHeight = nextHeight;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          lightWidth,
          lightHeight,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        );
        textureAllocated = true;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw Error("Optics framebuffer unavailable");
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      rects.fill(0);
      materials.fill(0);
      const paneOpacity = new Map<HTMLElement, number>();
      const panes = [...stage.querySelectorAll<HTMLElement>("[data-glass-pane], .panel")]
        .filter((element) => {
          // Only outer surfaces refract the scene. A nested chart may scroll
          // beyond its DOM clip; drawing its full rect here would leave a
          // detached lens on the background above/below the reading area.
          if (element.parentElement?.closest("[data-glass-pane], .panel")) return false;
          const rect = element.getBoundingClientRect();
          let opacity = 1;
          for (
            let ancestor: HTMLElement | null = element;
            ancestor && ancestor !== stage;
            ancestor = ancestor.parentElement
          ) {
            opacity *= Number(getComputedStyle(ancestor).opacity);
            if (opacity < 0.01) break;
          }
          paneOpacity.set(element, opacity);
          return (
            opacity >= 0.01 &&
            rect.bottom > Math.max(0, bounds.top) &&
            rect.top < Math.min(innerHeight, bounds.bottom) &&
            rect.width > 1 &&
            rect.height > 1 &&
            getComputedStyle(element).visibility !== "hidden"
          );
        })
        .slice(0, 12);
      // Re-observe only on geometry changes, never once per animation frame.
      const nextPanes = new Set(panes);
      for (const pane of observedPanes) {
        if (!nextPanes.has(pane)) {
          resizeObserver?.unobserve(pane);
          observedPanes.delete(pane);
        }
      }
      panes.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        rects.set(
          [rect.left - bounds.left, rect.top - bounds.top, rect.width, rect.height],
          index * 4,
        );
        materials.set(
          [
            parseFloat(getComputedStyle(element).borderTopLeftRadius) || 18,
            element.hasAttribute("data-glass-pane") ? Number(element.dataset.glassPane) || 0 : 0.6,
            element.hasAttribute("data-glass-texture")
              ? Number(element.dataset.glassTexture) || 0
              : element.hasAttribute("data-glass-pane")
                ? 0
                : 0.55,
            paneOpacity.get(element) ?? 1,
          ],
          index * 4,
        );
        if (!observedPanes.has(element)) {
          resizeObserver?.observe(element);
          observedPanes.add(element);
        }
      });
      reliefRects.fill(0);
      reliefMaterials.fill(0);
      let reliefIndex = 0;
      for (const element of stage.querySelectorAll<HTMLElement>("[data-glass-relief]")) {
        if (reliefIndex === 12) break;
        const rect = element.getBoundingClientRect();
        let left = Math.max(rect.left, bounds.left),
          top = Math.max(rect.top, bounds.top);
        let right = Math.min(rect.right, bounds.right),
          bottom = Math.min(rect.bottom, bounds.bottom);
        let opacity = 1;
        for (
          let ancestor: HTMLElement | null = element;
          ancestor && ancestor !== stage;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor);
          opacity *= Number(style.opacity);
          if (style.visibility === "hidden") opacity = 0;
          if (ancestor !== element) {
            const clip = ancestor.getBoundingClientRect();
            if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
              left = Math.max(left, clip.left);
              right = Math.min(right, clip.right);
            }
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
              top = Math.max(top, clip.top);
              bottom = Math.min(bottom, clip.bottom);
            }
          }
        }
        if (opacity < 0.01 || right <= left || bottom <= top) continue;
        reliefRects.set(
          [left - bounds.left, top - bounds.top, right - left, bottom - top],
          reliefIndex * 4,
        );
        reliefMaterials.set(
          [
            parseFloat(getComputedStyle(element).borderTopLeftRadius) || 8,
            Number(element.dataset.glassRelief) * opacity,
            0,
            0,
          ],
          reliefIndex * 4,
        );
        reliefIndex++;
      }
      gl.useProgram(glass.handle);
      gl.uniform4fv(rectLocation, rects);
      gl.uniform4fv(materialLocation, materials);
      gl.uniform4fv(reliefRectLocation, reliefRects);
      gl.uniform4fv(reliefMaterialLocation, reliefMaterials);
      gl.uniform2f(resolutionLocation, width, height);
      gl.uniform1i(textureLocation, 0);
    };
    const bind = (pass: OpticalProgram) => {
      gl.useProgram(pass.handle);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(pass.position);
      gl.vertexAttribPointer(pass.position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(pass.time, phase);
      gl.uniform1f(pass.theme, options.light ? 1 : 0);
      gl.uniform1f(pass.pattern, glassPatternValue(options.pattern ?? "smoke"));
    };
    draw = () => {
      if (disposed || gl.isContextLost()) return;
      try {
        if (dirty) updateGeometry();
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, lightWidth, lightHeight);
        bind(light);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        bind(glass);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (!checked) {
          checked = true;
          const error = gl.getError();
          stage.dataset.opticsError = String(error);
          if (error !== gl.NO_ERROR) throw Error("Optics draw failed");
        }
      } catch {
        cleanup();
        stage.dataset.optics = "fallback";
      }
    };
    resizeObserver = new ResizeObserver(geometryChanged);
    resizeObserver.observe(stage);
    mutationObserver = new MutationObserver(geometryChanged);
    mutationObserver.observe(stage, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "data-view",
        "data-conversation",
        "data-history-collapsed",
        "data-glass-pane",
        "data-glass-texture",
        "data-glass-relief",
        "hidden",
        "open",
      ],
    });
    intersectionObserver = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      sync();
    });
    intersectionObserver.observe(stage);
    stage.addEventListener("scroll", geometryChanged, { capture: true, passive: true });
    window.addEventListener("scroll", geometryChanged, { passive: true });
    window.addEventListener("resize", geometryChanged, { passive: true });
    document.addEventListener("visibilitychange", sync);
    ready = true;
    stage.dataset.optics = "webgl";
    updateGeometry();
    return {
      update(next: Playback) {
        options = next;
        sync();
      },
      dispose: cleanup,
    };
  } catch {
    cleanup();
    return null;
  }
}
