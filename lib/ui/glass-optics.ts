import { glassPatternValue, type GlassPattern } from "./glass-patterns";

/** Tolerant numeric read of a CSS custom property. Tokens are inherited from
 * `.glass-workspace` and overridden per pane by tier rules, so a pane's own
 * computed style is the source of truth. Unset or unparsable values fall back
 * instead of throwing while the stylesheet is still rolling out. */
function cssNumber(style: CSSStyleDeclaration, property: string, fallback: number) {
  const value = Number.parseFloat(style.getPropertyValue(property));
  return Number.isFinite(value) ? value : fallback;
}

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
    // Per pane: dot strength 0..1, pitch in CSS px, angle in radians, edge
    // refraction displacement in CSS px. Filled from CSS custom properties.
    uniform vec4 u_surface[12];
    uniform vec4 u_reliefRects[12];
    uniform vec4 u_reliefMaterials[12];
    uniform float u_pixelScale;
    uniform float u_dotVibrancy;
    uniform vec4 u_press;
    uniform vec4 u_pressRect;

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
      vec4 surface = vec4(0.0);
      for (int i = 0; i < 12; i++) {
        float distance = roundedRect(p, u_rects[i], u_materials[i].x);
        if (u_rects[i].z > 0.0 && distance < 0.0) {
          distanceToGlass = distance;
          pane = u_rects[i];
          material = u_materials[i];
          surface = u_surface[i];
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
        // adding another pane (which could escape a scrolling DOM clip). Their
        // relief value raises the dot lattice locally, without a second pass.
        float dotStrength = clamp(surface.x, 0.0, 1.0);
        for (int i = 0; i < 12; i++) {
          if (u_reliefRects[i].z > 0.0) {
            float d = roundedRect(p, u_reliefRects[i], u_reliefMaterials[i].x);
            if (d < 0.0) {
              float relief = u_reliefMaterials[i].y * smoothstep(0.0, 2.0, -d);
              // Nested accents emboss the outer pane; their relief value is a
              // fraction of the tier-3 cap, which is theme dependent.
              float reliefCap = mix(0.40, 0.55, u_lightTheme);
              dotStrength = min(relief * reliefCap, reliefCap);
            }
          }
        }
        // Point-lattice micro-lenses. Strength, pitch and angle arrive from CSS
        // custom properties, so no grid geometry is hard-coded; the lattice
        // bends the backdrop for real instead of only perturbing a normal.
        vec2 textureBend = vec2(0.0);
        vec2 facetNormal = vec2(0.0);
        float dotChroma = 0.0;
        if (dotStrength > 0.001) {
          float ca = cos(surface.z);
          float sa = sin(surface.z);
          // The lattice maths is carried out in canvas device pixels: u_pixelScale
          // lifts CSS pitch/distance into that space before the fract() grid.
          vec2 rotated = vec2(local.x * ca - local.y * sa, local.x * sa + local.y * ca)
                       * u_pixelScale;
          float pitch = max(surface.y * u_pixelScale, 2.5);
          vec2 cell = fract(rotated / pitch) - 0.5;
          float rr = length(cell);
          float dome = 1.0 - smoothstep(0.08, 0.48, rr);
          float lensSlope = 1.0 - smoothstep(0.25, 0.49, rr);
          vec2 rotatedBend = cell * lensSlope * dotStrength * pitch * 3.0;
          // Return the sampling offset from lattice space to screen space.
          // Rotating the lattice must also rotate each lens's refraction.
          vec2 dotBend = vec2(rotatedBend.x * ca + rotatedBend.y * sa,
                             -rotatedBend.x * sa + rotatedBend.y * ca);
          // Sampling below happens in CSS pixels, so bring the device-pixel
          // bend (and therefore the chroma spread it drives) back into CSS.
          textureBend = dotBend / u_pixelScale;
          dotChroma = length(textureBend) * 0.16;
          facetNormal = normalize(textureBend + vec2(1e-5)) * dome;
        }
        vec2 drift = vec2(2.2 * sin(u_time * 0.31 + local.y * 0.009),
                          1.4 * cos(u_time * 0.27 + local.x * 0.008));
        // The shader samples in CSS pixels, and --glass-refract-current is
        // already expressed in CSS pixels, so the Snell bend adds unchanged.
        vec2 bend = -normal * edge * edge * max(surface.w, 0.0) + drift;
        float pressMask = step(u_pressRect.x, p.x) * step(u_pressRect.y, p.y)
          * step(p.x, u_pressRect.x + u_pressRect.z)
          * step(p.y, u_pressRect.y + u_pressRect.w) * u_press.w;
        vec2 fromPress = p - u_press.xy;
        float pressDistance = length(fromPress);
        float pressRadius = u_press.z * length(u_pressRect.zw) * 0.75;
        float pressWave = exp(-pow((pressDistance - pressRadius) / 18.0, 2.0))
                        * (1.0 - u_press.z) * pressMask;
        bend += fromPress / max(pressDistance, 1.0) * pressWave * 5.0;
        float spectralWidth = (2.8 + edge * 10.0)
                            * mix(1.0, 0.35, smoke);
        vec2 spectralDirection = normalize(normal * edge + vec2(0.7, 0.4));
        vec2 refracted = p + bend;

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

        if (dotStrength > 0.001) {
          // Keep the background-derived lens detail after the broad frost.
          // A flat backdrop produces no printed white dots: only the change
          // between the bent and unbent samples is added to the frosted pane.
          vec2 lensPoint = refracted + textureBend;
          vec2 chroma = facetNormal * dotChroma;
          vec3 lensColor = vec3(lightAt(lensPoint + chroma).r,
                               lightAt(lensPoint).g,
                               lightAt(lensPoint - chroma).b);
          color += (lensColor - lightAt(refracted)) * min(0.9, dotStrength * 1.8);
        }

        color = mix(color, mix(vec3(0.055, 0.095, 0.12), vec3(0.83, 0.88, 0.86), u_lightTheme), 0.12 + frost * 0.18);
        vec3 neutralFrost = mix(vec3(0.08, 0.09, 0.10), vec3(0.85, 0.86, 0.87), u_lightTheme);
        color = mix(color, neutralFrost, smoke * 0.12);
        // Restrained signed relief, rather than a bright disc or dark grid.
        // The lighter theme needs less surface contrast, not whiter dots.
        if (dotStrength > 0.001) {
          float facetLight = dot(facetNormal, normalize(vec2(-0.65, -0.8)));
          color *= 1.0 + facetLight * dotStrength * mix(0.018, 0.006, u_lightTheme);
          // Dense dots read heavier, so vivid panes compensate saturation.
          float vibrancy = 1.0 + (u_dotVibrancy - 0.5) * 0.4;
          float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = mix(vec3(luma), color, vibrancy);
        }

        float polished = exp(-abs(distanceToGlass + 1.7) * 1.4);
        float movingGlint = 0.5 + 0.5 * sin(local.x * 0.008 + local.y * 0.012 - u_time * 0.45);
        vec3 edgeColor = mix(vec3(0.49, 0.66, 1.0), vec3(1.0, 0.76, 0.59), movingGlint);
        edgeColor = mix(edgeColor, vec3(0.70, 0.73, 0.77), smoke);
        color += polished * edgeColor * (0.30 + movingGlint * 0.38);
        color += edge * edge * vec3(0.027, 0.020, 0.045);
        color += pressWave * mix(vec3(0.025, 0.030, 0.032),
                                vec3(0.008, 0.010, 0.010), u_lightTheme);
        color = mix(lightAt(p), color, material.w);
      }

      // Subtle stationary dither prevents broad dark gradients from banding.
      float noise = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      color += (noise - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

type Playback = {
  animated: boolean;
  interactive?: boolean;
  light: boolean;
  pattern?: GlassPattern;
};
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
  const pressDuration = 280;
  let pressStarted = -Infinity;
  const pressPoint = new Float32Array(2);
  const pressRect = new Float32Array(4);
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
    stage.removeEventListener("pointerdown", press, true);
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
    const responding = timestamp - pressStarted < pressDuration;
    const finishingPress = Number.isFinite(pressStarted) && !responding;
    if (animated || responding || timestamp < settleUntil) frameId = requestAnimationFrame(tick);
    // Decorative optics stay bounded at 24fps with a display-aware pixel budget.
    // Always clear the final press frame, even when a paused background would
    // otherwise stop between two throttled frames and retain the ripple.
    if (previous && timestamp - previous < 1000 / 24 && !finishingPress) return;
    if (previous && animated) phase += Math.min((timestamp - previous) / 1000, 0.15);
    previous = timestamp;
    if (timestamp < settleUntil) dirty = true;
    draw();
    if (finishingPress) pressStarted = -Infinity;
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
  function press(event: PointerEvent) {
    if (!options.interactive || !event.isPrimary || event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    const card = event.target.closest<HTMLButtonElement>(".overview-metric");
    if (!card || card.disabled || !stage.contains(card)) return;
    // Measure only on the user's press, never on every frame. Playback time is
    // independent of the backdrop, so a paused light still gives click feedback.
    const bounds = stage.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    pressPoint.set([event.clientX - bounds.left, event.clientY - bounds.top]);
    pressRect.set([rect.left - bounds.left, rect.top - bounds.top, rect.width, rect.height]);
    pressStarted = performance.now();
    sync();
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
      materials = new Float32Array(48),
      surfaces = new Float32Array(48);
    const rectLocation = gl.getUniformLocation(glass.handle, "u_rects[0]");
    const materialLocation = gl.getUniformLocation(glass.handle, "u_materials[0]");
    const surfaceLocation = gl.getUniformLocation(glass.handle, "u_surface[0]");
    const reliefRects = new Float32Array(48),
      reliefMaterials = new Float32Array(48);
    const reliefRectLocation = gl.getUniformLocation(glass.handle, "u_reliefRects[0]");
    const reliefMaterialLocation = gl.getUniformLocation(glass.handle, "u_reliefMaterials[0]");
    const resolutionLocation = gl.getUniformLocation(glass.handle, "u_resolution");
    const textureLocation = gl.getUniformLocation(glass.handle, "u_light");
    const pixelScaleLocation = gl.getUniformLocation(glass.handle, "u_pixelScale");
    const dotVibrancyLocation = gl.getUniformLocation(glass.handle, "u_dotVibrancy");
    const pressLocation = gl.getUniformLocation(glass.handle, "u_press");
    const pressRectLocation = gl.getUniformLocation(glass.handle, "u_pressRect");
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
      surfaces.fill(0);
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
        const style = getComputedStyle(element);
        rects.set(
          [rect.left - bounds.left, rect.top - bounds.top, rect.width, rect.height],
          index * 4,
        );
        materials.set(
          [
            parseFloat(style.borderTopLeftRadius) || 18,
            element.hasAttribute("data-glass-pane") ? Number(element.dataset.glassPane) || 0 : 0.6,
            // Texture strength now lives in u_surface, driven by CSS variables;
            // untiered surfaces (including plain `.panel`) default to no dots.
            0,
            paneOpacity.get(element) ?? 1,
          ],
          index * 4,
        );
        surfaces.set(
          [
            Math.min(1, Math.max(0, cssNumber(style, "--glass-dot-current", 0))),
            cssNumber(style, "--glass-dot-pitch", 6.5),
            (cssNumber(style, "--glass-dot-angle", 45) * Math.PI) / 180,
            // Edge refraction is authored in CSS pixels; 32px matches the
            // pre-lattice baseline, and tier tokens override it per surface.
            Math.max(0, cssNumber(style, "--glass-refract-current", 32)),
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
      gl.uniform4fv(surfaceLocation, surfaces);
      gl.uniform4fv(reliefRectLocation, reliefRects);
      gl.uniform4fv(reliefMaterialLocation, reliefMaterials);
      gl.uniform2f(resolutionLocation, width, height);
      // CSS pixels -> canvas device pixels; pitch and refraction travel in CSS.
      gl.uniform1f(pixelScaleLocation, canvas.width / Math.max(width, 1));
      // One global vibrancy read per geometry pass is enough; it is a token.
      gl.uniform1f(
        dotVibrancyLocation,
        Math.min(1, Math.max(0, cssNumber(getComputedStyle(stage), "--glass-dot-vibrancy", 0.85))),
      );
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
        const pressProgress = Math.min(1, (performance.now() - pressStarted) / pressDuration);
        gl.uniform4f(
          pressLocation,
          pressPoint[0],
          pressPoint[1],
          pressProgress,
          options.interactive && pressProgress < 1 ? 1 : 0,
        );
        gl.uniform4fv(pressRectLocation, pressRect);
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
        "data-glass-tier",
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
    stage.addEventListener("pointerdown", press, { capture: true, passive: true });
    window.addEventListener("scroll", geometryChanged, { passive: true });
    window.addEventListener("resize", geometryChanged, { passive: true });
    document.addEventListener("visibilitychange", sync);
    ready = true;
    stage.dataset.optics = "webgl";
    updateGeometry();
    return {
      update(next: Playback) {
        // Tier tokens can depend on the theme (light glass raises dot strength)
        // or the pattern, and those flip attributes outside this observer, so
        // force a geometry/computed-style re-read when either changes.
        if (next.light !== options.light || next.pattern !== options.pattern) dirty = true;
        if (!next.interactive) pressStarted = -Infinity;
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
