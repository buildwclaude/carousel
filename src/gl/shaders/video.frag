precision highp float;

/* -------------------------------------------------------------------------
   Carousel — the whole film is this one fragment shader.

   The source is a graphite drawing on white paper and is fully achromatic
   (measured: median saturation 0.000, max 0.021). So the tonal chain inverts
   it — paper becomes the ground, graphite becomes the light — and the only
   colour that ever reaches the screen is the chromatic split, which is
   generated from the drawing itself and scales with scroll velocity.

   Order of operations matters: every artistic warp happens in PLANE space so
   it stays isotropic on screen, and the cover-fit correction is applied last,
   as the single map from plane space into texture space.

   uFit eases from cover toward contain on very narrow planes. Anything the
   sampler reaches for outside the source rect is masked to black rather than
   clamped — the drawing runs off the bottom edge of its frame, and a clamped
   edge would smear that into vertical streaks. Black is also exactly the
   page's own ground, so the letterbox never reads as a letterbox.
   ------------------------------------------------------------------------- */

varying vec2 vUv;

uniform sampler2D uTexture;
uniform vec2  uPlaneSize;     // px, on-screen size of the plane
uniform vec2  uTexSize;       // px, intrinsic video size
uniform vec2  uGridSize;      // fragment cells per axis (square on screen)
uniform vec2  uMouse;         // lerped, plane space, -1..1

uniform float uTime;
uniform float uVelocity;      // lerped scroll velocity, signed
uniform float uZoom;          // 1.0 == exact cover
uniform float uFit;           // 1.0 cover .. planeA/texA contain
uniform float uFocus;         // 0 soft .. 1 sharp
uniform float uContrast;
uniform float uExposure;
uniform float uPivot;
uniform float uInvert;
uniform float uFragment;      // 0 whole .. 1 fully shattered
uniform float uGrain;
uniform float uVignette;
uniform float uAberration;
uniform float uRefraction;
uniform float uDarken;
uniform float uOpacity;

const float PI = 3.14159265359;

/* --- noise ------------------------------------------------------------- */

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float filmGrain(vec2 uv, float t) {
  // three decorrelated samples per frame keeps it from reading as a pattern
  float n = hash21(uv * 1024.0 + vec2(t * 91.7, t * 47.3));
  float m = hash21(uv * 512.0 - vec2(t * 31.1, t * 73.9));
  return (n + m) * 0.5 - 0.5;
}

/* --- uv stages ---------------------------------------------------------- */

/* Cover fit. Computed from the plane's real on-screen pixel size, never from
   any assumed viewport ratio, so the framed act in section IV is as correct
   as the full-bleed ones. */
vec2 coverUV(vec2 uv) {
  float planeAspect = uPlaneSize.x / max(uPlaneSize.y, 1.0);
  float texAspect   = uTexSize.x / max(uTexSize.y, 1.0);
  vec2 s = planeAspect > texAspect
    ? vec2(1.0, texAspect / planeAspect)   // plane wider: crop top and bottom
    : vec2(planeAspect / texAspect, 1.0);  // plane taller: crop left and right
  return (uv - 0.5) * s / max(uZoom * uFit, 0.0001) + 0.5;
}

/* Scroll-driven displacement. uVelocity arrives already lerped toward zero,
   so this settles to a clean image the instant scrolling stops. */
vec2 displace(vec2 uv, float v) {
  vec2 p = uv - 0.5;
  float fall = 1.0 - smoothstep(0.0, 0.85, abs(p.y));

  // a shear that leans into the direction of travel
  uv.x += v * 0.055 * fall * (0.35 + 0.65 * abs(p.y) * 2.0);

  // and a slow ripple running across the plane
  float wave = sin(p.y * 7.5 - uTime * 1.1) * 0.5 + sin(p.y * 3.1 + uTime * 0.6) * 0.5;
  uv.x += wave * v * 0.03;
  uv.y += sin(p.x * 5.0 + uTime * 0.8) * v * 0.012;

  // and a touch of longitudinal squeeze, so fast scroll compresses the image
  uv.y += p.y * abs(v) * -0.035;
  return uv;
}

/* Soft lens that trails the cursor. Radial, falls off fast, never a hard edge. */
vec2 refract2(vec2 uv) {
  vec2 d = uv - (uMouse * 0.5 + 0.5);
  d.x *= uPlaneSize.x / max(uPlaneSize.y, 1.0);   // keep the lens circular
  float r = length(d);
  float lens = exp(-r * r * 9.0);
  return uv - normalize(d + 1e-6) * lens * uRefraction * 0.055;
}

/* Act III. The plane subdivides shader-side: each cell samples a displaced,
   slightly re-scaled and rotated crop of the same frame, so the carousel
   shatters into a mosaic of itself and then reassembles. */
vec2 fragmentTiles(vec2 uv, out float tone, out float seam) {
  tone = 1.0;
  seam = 1.0;
  if (uFragment <= 0.0005) return uv;

  vec2 gv   = uv * uGridSize;
  vec2 cell = floor(gv);
  vec2 f    = fract(gv);

  float h1 = hash21(cell);
  float h2 = hash21(cell + 31.7);
  float h3 = hash21(cell - 17.3);

  // rows travel as rows; cells then break rank within them
  float row = hash21(vec2(cell.y, 7.0)) * 2.0 - 1.0;
  vec2 dir = vec2(row * 0.75 + (h1 - 0.5) * 0.5, (h2 - 0.5) * 0.55);

  float stagger = 0.55 + 0.45 * h3;              // cells do not move together
  vec2 offset = dir * uFragment * stagger * 0.28;

  // per-cell scale and rotation about the cell centre
  float z = 1.0 + (h2 - 0.5) * uFragment * 0.45;
  float a = (h3 - 0.5) * uFragment * 0.22;
  float ca = cos(a), sa = sin(a);
  vec2 c = f - 0.5;
  c = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca) / z;

  // a hairline of ground between cells, only while they are apart
  vec2 edge = smoothstep(vec2(0.0), vec2(0.012), f) *
              smoothstep(vec2(0.0), vec2(0.012), 1.0 - f);
  seam = mix(1.0, edge.x * edge.y, uFragment);

  tone = 1.0 - h2 * 0.4 * uFragment;              // cells fall out of the light

  return (cell + c + 0.5) / uGridSize + offset;
}

/* --- sampling ----------------------------------------------------------- */

vec3 sampleSource(vec2 planeUv, float split, out float inside) {
  vec2 p = planeUv - 0.5;
  vec2 dir = length(p) > 1e-5 ? normalize(p) : vec2(0.0);

  // aberration is strongest at the edges of the plane and under velocity
  vec2 o = dir * split;

  vec2 tc = coverUV(planeUv);

  // anything reaching past the source rect is void, not a smeared edge pixel
  vec2 e = smoothstep(vec2(0.0), vec2(0.0035), tc) *
           smoothstep(vec2(0.0), vec2(0.0035), 1.0 - tc);
  inside = e.x * e.y;

  float r = texture2D(uTexture, clamp(coverUV(planeUv + o), 0.0, 1.0)).r;
  float g = texture2D(uTexture, clamp(tc,                   0.0, 1.0)).g;
  float b = texture2D(uTexture, clamp(coverUV(planeUv - o), 0.0, 1.0)).b;
  return vec3(r, g, b);
}

void main() {
  vec2 uv = vUv;

  #ifndef REDUCED
    uv = displace(uv, uVelocity);
    uv = refract2(uv);
  #endif

  float tone, seam;
  #ifdef MOBILE
    tone = 1.0; seam = 1.0;
  #else
    uv = fragmentTiles(uv, tone, seam);
  #endif

  // edge-weighted base aberration, plus the velocity term
  float edge = pow(clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0), 2.2);
  float split = (uAberration * 0.0009 * edge) + abs(uVelocity) * 0.0045 * (0.3 + edge);

  float inside;
  vec3 col = sampleSource(uv, split, inside);

  // Focus. A short rotated ring of taps, only while the image is soft.
  #ifndef MOBILE
  if (uFocus < 0.995) {
    float rad = (1.0 - uFocus) * 0.018;
    vec3 soft = vec3(0.0);
    float tapInside;
    for (int i = 0; i < 5; i++) {
      float a = float(i) * (PI * 2.0 / 5.0) + uTime * 0.35;
      soft += sampleSource(uv + vec2(cos(a), sin(a)) * rad, split, tapInside);
    }
    col = mix(soft / 5.0, col, 0.35 + uFocus * 0.65);
  }
  #endif

  // --- tonal chain -------------------------------------------------------
  // paper becomes the ground, graphite becomes the light
  col = mix(col, vec3(1.0) - col, uInvert);

  col = (col - uPivot) * uContrast + uPivot;
  col *= uExposure;

  col *= tone * seam;

  /* The void is masked here, after the whole tonal chain, and deliberately not
     earlier: before the inversion it would turn white, and before the contrast
     pivot the pivot itself would lift it off black whenever contrast < 1 —
     which is exactly the cold open. */
  col *= inside;

  // vignette
  vec2 vp = vUv - 0.5;
  vp.x *= uPlaneSize.x / max(uPlaneSize.y, 1.0);
  float vig = 1.0 - smoothstep(0.34, 0.92, length(vp)) * uVignette;
  col *= vig;

  // grain, weighted toward the midtones so the blacks stay clean.
  // Under reduced motion it is seeded by a constant: still present as texture,
  // but no longer moving. It would otherwise be the only thing on the page
  // that still animates.
  #ifdef REDUCED
    float grainTime = 0.0;
  #else
    float grainTime = uTime;
  #endif
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float gw = 4.0 * lum * (1.0 - lum);
  col += filmGrain(vUv, grainTime) * uGrain * (0.35 + 0.65 * gw) * inside;

  col *= (1.0 - uDarken);
  col = max(col, vec3(0.0));

  // Fade on the colour, not the alpha: the material is opaque, so an alpha
  // fade would be discarded, and fading to black is what this page wants.
  gl_FragColor = vec4(col * uOpacity, 1.0);
}
