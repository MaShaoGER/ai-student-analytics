/* Procedural light + chromatic glass. No images, dependencies, or data requests. */
(() => {
  'use strict';

  const canvas = document.getElementById('optics-canvas');
  const stage = document.querySelector('.canvas');
  const toggle = document.getElementById('motion-toggle');
  const label = toggle.querySelector('span');
  const icon = toggle.querySelector('path');
  const status = document.getElementById('motion-state');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const WIDTH = 1600;
  const HEIGHT = 1120;
  // Only the softly colored backdrop is downsampled; glass and DOM text stay sharp.
  const LIGHT_WIDTH = 960;
  const LIGHT_HEIGHT = 672;
  const FRAME_INTERVAL = 1000 / 30;
  let animationId = 0;
  let previousPaint = 0;
  let phase = 2.4;
  let frames = 0;
  let paused = false;
  let ready = false;

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

    float band(float d, float width) {
      float v = d / width;
      return exp(-v * v);
    }

    void main() {
      vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
      float t = u_time;
      vec2 p = (uv - 0.5) * vec2(1.45, 1.0);
      p.x += 0.065 * sin(p.y * 5.0 + t * 0.18);
      p.y += 0.025 * cos(p.x * 6.0 - t * 0.17);

      // A wide folded ribbon and a lower return curve, inspired by moving light.
      float bend = 0.20 * sin(p.x * 4.1 + t * 0.29)
                 + 0.045 * sin(p.x * 9.0 - t * 0.13);
      float d = p.y - bend + 0.09;
      float lower = p.y - 0.38 + 0.15 * cos(p.x * 4.3 - t * 0.19);
      float upper = p.y + 0.56 - 0.13 * sin(p.x * 3.4 + t * 0.21);

      vec3 color = mix(vec3(0.037, 0.048, 0.073),
                       vec3(0.083, 0.073, 0.122), uv.y);
      float ambient = exp(-dot((uv - vec2(0.88, 0.38)) * vec2(1.2, 1.0),
                              (uv - vec2(0.88, 0.38)) * vec2(1.2, 1.0)) * 3.5);
      color += vec3(0.075, 0.048, 0.15) * ambient;
      color += vec3(0.27, 0.12, 0.44) * band(d + 0.065, 0.11) * 0.9;
      color += vec3(0.61, 0.29, 0.38) * band(d + 0.012, 0.043) * 0.72;
      color += vec3(1.00, 0.77, 0.45) * band(d, 0.011) * 0.88;
      color += vec3(0.25, 0.34, 0.61) * band(d - 0.038, 0.023) * 0.75;
      color += vec3(0.19, 0.08, 0.34) * band(d - 0.073, 0.075) * 0.6;

      color += vec3(0.29, 0.13, 0.43) * band(lower + 0.035, 0.060) * 0.75;
      color += vec3(0.86, 0.49, 0.39) * band(lower, 0.022) * 0.77;
      color += vec3(1.00, 0.86, 0.57) * band(lower - 0.009, 0.006) * 0.7;
      color += vec3(0.23, 0.37, 0.59) * band(lower - 0.025, 0.014) * 0.62;
      color += vec3(0.46, 0.22, 0.52) * band(upper, 0.065) * 0.6;
      color += vec3(0.92, 0.55, 0.36) * band(upper + 0.008, 0.018) * 0.75;

      // The left reading area is calmer; the optical focal point is to its right.
      float readingMask = mix(0.44, 1.0, smoothstep(0.08, 0.72, uv.x));
      color *= readingMask;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

  const glassSource = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_light;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec4 u_rects[7];
    uniform vec2 u_materials[7];

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
      vec2 material = vec2(18.0, 0.0);
      for (int i = 0; i < 7; i++) {
        float distance = roundedRect(p, u_rects[i], u_materials[i].x);
        if (distance < distanceToGlass) {
          distanceToGlass = distance;
          pane = u_rects[i];
          material = u_materials[i];
        }
      }

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

        // Fine flutes and a small engraved lattice bend only the transmitted light.
        float flute = sin(local.x * 0.137 + sin(local.y * 0.014) * 0.6);
        float fineX = sin(local.x * 1.35);
        float fineY = sin(local.y * 1.35);
        vec2 textureNormal = vec2(cos(local.x * 0.137) * 2.1, flute * 0.45);
        textureNormal += vec2(fineX * fineY, cos(local.x * 1.35) * fineY) * 0.3;
        vec2 drift = vec2(2.2 * sin(u_time * 0.31 + local.y * 0.009),
                          1.4 * cos(u_time * 0.27 + local.x * 0.008));
        vec2 bend = -normal * edge * edge * 18.0
                  + textureNormal * (1.0 - frost * 0.6) + drift;
        float spectralWidth = 1.1 + edge * 4.8;
        vec2 spectralDirection = normalize(normal * edge + vec2(0.7, 0.4));
        vec2 refracted = p + bend;

        color = vec3(
          lightAt(refracted + spectralDirection * spectralWidth).r,
          lightAt(refracted).g,
          lightAt(refracted - spectralDirection * spectralWidth).b
        );
        if (frost > 0.2) {
          vec3 softened = lightAt(refracted) * 0.24
            + lightAt(refracted + vec2(11.0, 7.0)) * 0.19
            + lightAt(refracted + vec2(-11.0, -7.0)) * 0.19
            + lightAt(refracted + vec2(8.0, -12.0)) * 0.19
            + lightAt(refracted + vec2(-8.0, 12.0)) * 0.19;
          color = mix(color, softened, frost);
        }

        color = mix(color, vec3(0.071, 0.086, 0.125), 0.24 + frost * 0.24);
        float lightLevel = dot(color, vec3(0.21, 0.72, 0.07));
        float engraving = pow(0.5 + 0.5 * fineX * fineY, 4.0);
        color += engraving * vec3(0.048, 0.040, 0.064) * (0.25 + lightLevel);
        color += (flute * 0.5 + 0.5) * vec3(0.005, 0.005, 0.012);

        float polished = exp(-abs(distanceToGlass + 1.7) * 1.4);
        float movingGlint = 0.5 + 0.5 * sin(local.x * 0.008 + local.y * 0.012 - u_time * 0.45);
        vec3 edgeColor = mix(vec3(0.49, 0.66, 1.0), vec3(1.0, 0.76, 0.59), movingGlint);
        color += polished * edgeColor * (0.16 + movingGlint * 0.22);
        color += edge * edge * vec3(0.027, 0.020, 0.045);
      }

      // Subtle stationary dither prevents broad dark gradients from banding.
      float noise = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      color += (noise - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

  function showFallback() {
    ready = false;
    cancelAnimationFrame(animationId);
    canvas.hidden = true;
    stage.dataset.optics = 'fallback';
    stage.dataset.motion = 'static';
    status.textContent = '静态玻璃材质';
    label.textContent = '静态预览';
    toggle.disabled = true;
  }

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
  if (!gl) {
    showFallback();
    return;
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not allocate optical shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message || 'Optical shader did not compile');
    }
    return shader;
  }

  function program(fragmentSource) {
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const handle = gl.createProgram();
    if (!handle) throw new Error('Could not allocate optical program');
    gl.attachShader(handle, vertex);
    gl.attachShader(handle, fragment);
    gl.linkProgram(handle);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(handle) || 'Optical program did not link');
    }
    return {
      handle,
      position: gl.getAttribLocation(handle, 'a_position'),
      time: gl.getUniformLocation(handle, 'u_time'),
    };
  }

  try {
    const light = program(lightSource);
    const glass = program(glassSource);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LIGHT_WIDTH, LIGHT_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('The optical light buffer is unavailable');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const paneSelectors = [
      '.metrics', '.primary-grid > .glass:first-child', '.ai-panel',
      '.secondary-grid > .glass:nth-child(1)', '.secondary-grid > .glass:nth-child(2)',
      '.secondary-grid > .glass:nth-child(3)', '.composer',
    ];
    const frostLevels = [0.12, 0.05, 0.85, 0.12, 0.08, 0.72, 0.35];
    const rects = new Float32Array(28);
    const materials = new Float32Array(14);
    const stageBounds = stage.getBoundingClientRect();
    paneSelectors.forEach((selector, index) => {
      const element = document.querySelector(selector);
      const bounds = element.getBoundingClientRect();
      rects.set([bounds.left - stageBounds.left, bounds.top - stageBounds.top, bounds.width, bounds.height], index * 4);
      materials.set([parseFloat(getComputedStyle(element).borderTopLeftRadius), frostLevels[index]], index * 2);
    });
    gl.useProgram(glass.handle);
    gl.uniform4fv(gl.getUniformLocation(glass.handle, 'u_rects[0]'), rects);
    gl.uniform2fv(gl.getUniformLocation(glass.handle, 'u_materials[0]'), materials);
    gl.uniform2f(gl.getUniformLocation(glass.handle, 'u_resolution'), WIDTH, HEIGHT);
    gl.uniform1i(gl.getUniformLocation(glass.handle, 'u_light'), 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    function bindPass(pass) {
      gl.useProgram(pass.handle);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(pass.position);
      gl.vertexAttribPointer(pass.position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(pass.time, phase);
    }

    function draw() {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, LIGHT_WIDTH, LIGHT_HEIGHT);
      bindPass(light);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, WIDTH, HEIGHT);
      bindPass(glass);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frames += 1;
    }

    const shouldRun = () => ready && !paused && !preference.matches && !document.hidden;

    function frame(timestamp) {
      if (!shouldRun()) return;
      animationId = requestAnimationFrame(frame);
      if (previousPaint && timestamp - previousPaint < FRAME_INTERVAL - 1) return;
      if (previousPaint) phase += Math.min((timestamp - previousPaint) / 1000, 0.12);
      previousPaint = timestamp;
      draw();
    }

    function syncPlayback() {
      if (!ready) return;
      cancelAnimationFrame(animationId);
      previousPaint = 0;
      toggle.disabled = preference.matches;
      toggle.setAttribute('aria-pressed', String(paused));
      icon.setAttribute('d', paused ? 'M4 2l6 4-6 4z' : 'M4 2v8M8 2v8');
      if (preference.matches) {
        stage.dataset.motion = 'reduced';
        label.textContent = '减少动态效果';
        status.textContent = '静态折射 · 跟随系统偏好';
      } else {
        stage.dataset.motion = paused ? 'paused' : 'running';
        label.textContent = paused ? '继续光流' : '暂停光流';
        status.textContent = paused ? '流光折射 · 已暂停' : '流光折射 · 缓慢流动';
      }
      if (!document.hidden) draw();
      if (shouldRun()) animationId = requestAnimationFrame(frame);
    }

    ready = true;
    stage.dataset.optics = 'webgl';
    window.__glassPreview = Object.freeze({
      getState: () => ({ renderer: 'webgl', frames, phase, paused, reducedMotion: preference.matches,
        state: stage.dataset.motion, resolution: [WIDTH, HEIGHT], lightBuffer: [LIGHT_WIDTH, LIGHT_HEIGHT] }),
    });
    toggle.addEventListener('click', () => { paused = !paused; syncPlayback(); });
    preference.addEventListener('change', syncPlayback);
    document.addEventListener('visibilitychange', syncPlayback);
    canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); showFallback(); });
    window.addEventListener('pagehide', () => cancelAnimationFrame(animationId));
    window.addEventListener('pageshow', syncPlayback);
    syncPlayback();
  } catch (error) {
    console.warn('Optical preview switched to its static material:', error);
    showFallback();
  }
})();
