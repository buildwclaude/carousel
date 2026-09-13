precision highp float;

/* -------------------------------------------------------------------------
   The ring-toss booth.

   Same tonal treatment as the film — the source is graphite on white paper
   and fully achromatic, so it is inverted and the ink becomes the light.
   On top of that, two things the still image needs and the film does not:

   - twinkle: the drawing's sparkle marks and finest lines are isolated with a
     high-pass against their own local average, then pulsed on independent
     phases so they glint out of step with each other.
   - glow: a soft additive bloom, thresholded so only the bright ink halos,
     breathing slowly. This is what makes the canopy and the prize shelf read
     as lit rather than drawn.

   Both are achromatic, like everything else here. The page's only colour is
   still the chromatic split.
   ------------------------------------------------------------------------- */

varying vec2 vUv;

uniform sampler2D uTexture;
uniform vec2  uPlaneSize;
uniform vec2  uTexSize;

uniform float uTime;
uniform float uZoom;
uniform float uFit;
uniform float uContrast;
uniform float uExposure;
uniform float uPivot;
uniform float uInvert;
uniform float uTwinkle;
uniform float uGlow;
uniform float uGrain;
uniform float uVignette;
uniform float uAberration;
uniform float uOpacity;
uniform float uMatte;       // how readily luminance becomes opacity
uniform float uBackdrop;    // strength of the soft pool behind the drawing
uniform float uReveal;      // 0 hidden .. 1.3+ fully drawn in

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const vec3  W = vec3(0.299, 0.587, 0.114);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float filmGrain(vec2 uv, float t) {
  float n = hash21(uv * 1024.0 + vec2(t * 91.7, t * 47.3));
  float m = hash21(uv * 512.0 - vec2(t * 31.1, t * 73.9));
  return (n + m) * 0.5 - 0.5;
}

vec2 coverUV(vec2 uv) {
  float planeAspect = uPlaneSize.x / max(uPlaneSize.y, 1.0);
  float texAspect   = uTexSize.x / max(uTexSize.y, 1.0);
  vec2 s = planeAspect > texAspect
    ? vec2(1.0, texAspect / planeAspect)
    : vec2(planeAspect / texAspect, 1.0);
  return (uv - 0.5) * s / max(uZoom * uFit, 0.0001) + 0.5;
}

/* one graded sample: cover-fit, masked outside the source, inverted, levelled */
vec3 graded(vec2 uv, out float inside) {
  vec2 tc = coverUV(uv);
  vec2 e = smoothstep(vec2(0.0), vec2(0.004), tc) *
           smoothstep(vec2(0.0), vec2(0.004), 1.0 - tc);
  inside = e.x * e.y;

  vec3 c = texture2D(uTexture, clamp(tc, 0.0, 1.0)).rgb;
  c = mix(c, vec3(1.0) - c, uInvert);
  c = (c - uPivot) * uContrast + uPivot;
  return max(c * uExposure, vec3(0.0));
}

vec3 gradedSplit(vec2 uv, float split, out float inside) {
  vec2 p = uv - 0.5;
  vec2 dir = length(p) > 1e-5 ? normalize(p) : vec2(0.0);
  float dummy;
  vec3 a = graded(uv + dir * split, dummy);
  vec3 b = graded(uv, inside);
  vec3 c = graded(uv - dir * split, dummy);
  return vec3(a.r, b.g, c.b);
}

void main() {
  vec2 uv = vUv;

  float edge = pow(clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0), 2.2);
  float split = uAberration * 0.0010 * edge;

  float inside;
  vec3 col = gradedSplit(uv, split, inside);

  float aspect = uPlaneSize.x / max(uPlaneSize.y, 1.0);
  vec2 agx = vec2(1.0 / max(aspect, 0.0001), 1.0);   // keep the rings circular

  #ifdef MOBILE
    const int RING = 4;
  #else
    const int RING = 6;
  #endif

  /* --- twinkle: high-pass against the local average --------------------- */
  float lum = dot(col, W);
  float local = 0.0;
  for (int i = 0; i < RING; i++) {
    float a = float(i) * (TAU / float(RING));
    float d;
    local += dot(graded(uv + vec2(cos(a), sin(a)) * agx * 0.006, d), W);
  }
  local /= float(RING);

  float detail = max(0.0, lum - local);

  // independent phase per small neighbourhood, so glints fire out of step
  float phase = hash21(floor(vUv * 90.0)) * TAU;
  float pulse = pow(0.5 + 0.5 * sin(uTime * 1.9 + phase), 4.0);
  col += detail * pulse * uTwinkle;

  /* --- glow: thresholded soft bloom ------------------------------------- */
  vec3 bloom = vec3(0.0);
  for (int i = 0; i < RING; i++) {
    float a = float(i) * (TAU / float(RING)) + 0.4;
    float d;
    bloom += graded(uv + vec2(cos(a), sin(a)) * agx * 0.022, d);
    bloom += graded(uv + vec2(cos(a), sin(a)) * agx * 0.045, d) * 0.5;
  }
  bloom /= float(RING) * 1.5;
  bloom = max(bloom - 0.16, vec3(0.0));           // only the bright ink halos
  float breathe = 0.72 + 0.28 * sin(uTime * 0.75);
  col += bloom * uGlow * breathe;

  col *= inside;

  /* --- reveal: the drawing wipes upward as the section arrives ----------
     vUv.y is 0 at the bottom of the plane, so the band rises as uReveal grows.
     uReveal must pass ~1.3 for the top edge to clear the ramp. */
  col *= 1.0 - smoothstep(uReveal - 0.3, uReveal, vUv.y);

  vec2 vp = vUv - 0.5;
  vp.x *= aspect;
  col *= 1.0 - smoothstep(0.36, 0.95, length(vp)) * uVignette;

  float l = dot(col, W);
  col += filmGrain(vUv, uTime) * uGrain * (0.35 + 0.65 * 4.0 * l * (1.0 - l)) * inside;

  /* Soft pool behind the drawing — the shader's version of the blurred plates
     that sit behind the copy. It has to live here rather than in the DOM: the
     booth is drawn inside the canvas, and any DOM layer would sit on top of
     it. A rounded-box distance field feathered to nothing before the plane
     edge, so it reads as a pool of shade and never as a rectangle. */
  float pAspect = uPlaneSize.x / max(uPlaneSize.y, 1.0);
  vec2 q = (vUv - 0.5) * vec2(pAspect, 1.0);
  vec2 halfBox = vec2(pAspect, 1.0) * 0.5 - vec2(0.045);
  vec2 dq = abs(q) - halfBox + 0.08;
  float sd = min(max(dq.x, dq.y), 0.0) + length(max(dq, 0.0)) - 0.08;
  float pool = (1.0 - smoothstep(-0.075, 0.055, sd))
             * uBackdrop * uOpacity * clamp(uReveal, 0.0, 1.0);

  /* Transparent by luminance, premultiplied.
     After the inversion the paper is black and the ink is light, so luminance
     *is* the matte: the blank paper carries no alpha and the film shows
     straight through it, while the strokes are opaque enough to read. The
     wipe, the vignette and the out-of-frame mask all scale col, so they scale
     the alpha with it for free — the booth fades out rather than fading to a
     black rectangle. */
  vec3 outCol = max(col, vec3(0.0)) * uOpacity;
  float alpha = clamp(dot(outCol, W) * uMatte + pool, 0.0, 1.0);
  gl_FragColor = vec4(outCol, alpha);
}
