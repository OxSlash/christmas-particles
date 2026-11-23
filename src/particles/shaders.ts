export const particleVertexShader = /* glsl */ `
uniform float uTime;
uniform float uViewportH;
uniform float uWorldSize;
uniform float uBurst;
uniform float uSwell;
uniform float uFit;
uniform float uIdle;
uniform float uBreath;
uniform float uWave;

attribute vec3 aColor;
attribute float aSeed;
attribute float aSize;
attribute float aDepth;

varying vec3 vColor;
varying float vAlpha;

// --- compact 3D simplex noise (Ashima / Stefan Gustavson) ---
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  // position is the particle's *current* location, already tweened on the CPU.
  // Nothing is mixed here: the shader only decorates.
  vec3 pos = position * uFit;

  // uSwell is driven by how far the cloud still is from its target, so the
  // swirl is strong mid-transition and vanishes once the shape has landed.
  vec3 seedOffset = vec3(aSeed * 31.7, aSeed * 57.3, aSeed * 91.1);
  vec3 nOff = vec3(
    snoise(pos * 0.85 + seedOffset + vec3(uTime * 0.35, 0.0, 0.0)),
    snoise(pos * 0.85 + seedOffset + vec3(0.0, uTime * 0.4, 17.0)),
    snoise(pos * 0.85 + seedOffset + vec3(0.0, 31.0, uTime * 0.45))
  );

  float travel = uSwell * 1.35 + uBurst * 3.2;
  pos += nOff * travel;

  // radial push during bursts reads as an explosion from the centre
  vec3 radial = normalize(pos + vec3(0.0001));
  pos += radial * uBurst * (0.9 + aSeed * 1.6);

  // --- idle life ----------------------------------------------------------
  // A landed shape used to be perfectly still, which read as a frozen image.
  // uIdle is 1 once the morph finishes, so these only kick in when the shape is
  // complete and fade out automatically while it is still travelling.
  if (uIdle > 0.001) {
    // slow orbiting drift, each particle with its own phase
    float a = uWave * 0.35 + aSeed * 6.28318;
    pos.x += sin(a) * 0.035 * uIdle;
    pos.y += cos(a * 1.3) * 0.028 * uIdle;

    // a wave travelling up the shape, so it looks like it is breathing
    float wave = sin(pos.y * 3.0 - uWave * 2.2 + aSeed * 2.0);
    pos += radial * wave * 0.026 * uIdle;

    // gentle global pulse
    pos *= 1.0 + (uBreath - 0.5) * 0.012 * uIdle;

    // the whole cloud rocks very slightly, like it is suspended in air
    pos.x += sin(uWave * 0.5) * 0.02 * uIdle;
    pos.y += cos(uWave * 0.42) * 0.016 * uIdle;
  }

  // idle breathing
  float breath = sin(uTime * 0.85 + aSeed * 6.28318) * 0.5 + 0.5;
  pos += normalize(pos + vec3(0.0001)) * breath * 0.022;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // constant world-space size, plus a depth-of-field bloom: particles away from
  // the focal plane spread out and fade, which reads like a real lens
  float dist = max(0.15, -mvPosition.z);
  float defocus = 1.0 + aDepth * 1.9;
  gl_PointSize = aSize * uWorldSize * uViewportH / dist * defocus;
  gl_PointSize = clamp(gl_PointSize, 1.0, 30.0);

  vColor = aColor;
  // sparkle: a slow per-particle shimmer so the cloud feels alive, never static
  float shimmer = 0.82 + 0.18 * sin(uTime * 2.1 + aSeed * 43.0);
  vAlpha = (0.55 + 0.45 * breath) * shimmer * (1.0 - aDepth * 0.55);
}
`;

export const particleFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  float core = smoothstep(0.5, 0.02, d);
  float halo = pow(core, 2.4);
  float spark = pow(core, 9.0) * 1.8;

  vec3 col = vColor * (halo * 0.9 + spark);

  // additive: alpha carries the falloff
  gl_FragColor = vec4(col, 1.0) * vAlpha;
}
`;
