# Carousel — a study in return

Two graphite drawings — a carousel and a ring-toss booth — rendered as WebGL
shaders and scrolled through eight sections.

```bash
npm install
npm run dev
```

## The one decision everything else follows from

Both sources — `public/carousel.mp4` (1280×720, 24fps, 6.875s, stereo audio)
and `public/shop.jpg` — are pen-and-graphite drawings on white paper, and both
are **completely achromatic**: measured median saturation 0.000, maximum 0.023.

### The loop is built, not found

The delivered video had two defects that read as a stall every time it wrapped:
frames 0 and 1 were **identical** (an 83ms freeze at every loop start), and the
first and last frames didn't match (frame difference 437 against a typical
frame-to-frame motion of 27), so the wrap read as a restart. There is no
natural loop point — the carousel never completes a rotation in 7.4s.

`public/carousel.mp4` is therefore a rebuild: duplicate frame dropped, video
and audio trimmed to exactly equal length, and the tail crossfaded into the
head over 0.5s. The seam is now **30** against a typical 27 — indistinguishable
from any other frame transition. The cost is soft ghosting during the half
second of dissolve, which reads as a double exposure.

So the fragment shader **inverts it**: paper becomes the ground, graphite
becomes the light, and the drawing's sparkle marks become actual points of
light. That is what earns the near-black palette, rather than imposing it on a
high-key source.

For the same reason there is no accent hue. Inventing one would contradict the
material. The only colour that ever reaches the screen is the **chromatic
aberration**, generated from the drawing itself and scaled by scroll velocity —
the page is monochrome until you move.

## Structure

```
index.html                  semantic markup for all five acts
src/
  main.js                   boot, teardown, one shared clock
  gl/
    Scene.js                renderer, ortho camera, loop, resize, pause
    VideoPlane.js           geometry, ShaderMaterial, damped inputs
    ImagePlane.js           the booth: DOM-following plane, glow shader
    shaders/video.vert
    shaders/video.frag      the entire film
    shaders/image.frag      inversion + twinkle + bloom for the booth
  animation/
    scroll.js               Lenis <-> ScrollTrigger <-> GSAP ticker
    timelines.js            the five acts
  ui/preloader.js           real buffered-progress loader
  styles/main.css
```

The shaders are loaded with Vite's built-in `?raw`. There is deliberately no
GLSL plugin: `vite-plugin-glsl@1.6` filters on Vite 6.3+'s transform-filter API
and, on Vite 5, silently rewrites *every* module into a string.

### Everything is one fragment shader

Cover-fit, scroll displacement, mouse refraction, RGB split, focus, tone, tile
fragmentation, vignette and grain all happen in a single pass over one
full-screen quad. `EffectComposer` is not used: every effect already lives in
that pass, so a composer would only add a render target and a second
full-screen draw for nothing.

Order matters, and the comments in `video.frag` say why. The two that bite:

- Cover-fit is derived from the plane's **real on-screen pixel size**, never an
  assumed viewport ratio — which is what keeps act IV's bounded frame as
  correct as the full-bleed acts. The frame itself is measured off the DOM, so
  the layout and the GL can't drift apart.
- Out-of-frame sampling is masked to black **after** the tonal chain. Before
  the inversion it would read white; before the contrast pivot the pivot lifts
  it off black whenever contrast < 1, which is exactly the cold open.

### Scroll

Lenis drives `ScrollTrigger.update`, and GSAP's ticker drives Lenis *and* the
renderer, so the page has a single clock. Raw scroll delta never reaches a
uniform: velocity decays toward zero as a target, and the uniform is damped
toward that target — two stages, so a flick arrives as a swell and settles.

Each act is a pinned `ScrollTrigger` with a scrubbed timeline on a normalised
0..1 clock. Because five scrubbed timelines share one set of uniforms and a
refresh sweeps all of them, a `refresh` listener re-renders whichever act
actually owns the current scroll position, last.

### Sections

Five **pinned** effect acts carry the film; three **unpinned** reading sections
carry the argument and move at reading speed. The reading sections are what the
scroll is for — the pinned acts were doing all the work before, which meant
long stretches of scrolling past an effect with nothing to read.

| # | Section | Kind |
|---|---|---|
| I | Cold open — "Round and round" | pinned · `optical-fringe` |
| II | The reveal | pinned · `tonal-negative` |
| III | Origins | reading |
| IV | Fragment | pinned · `spatial-tiles` |
| V | The ring — booth image | reading + `ImagePlane` |
| VI | Framed | pinned · `layout-framed` |
| VII | Field notes | reading |
| VIII | Close | pinned |

### The booth

`ImagePlane` is a second GL plane that follows `#ring-frame` by
`getBoundingClientRect` every frame it is visible — its section is not pinned,
so there is no box to tween and nothing that can desync. It is `mesh.visible =
false` outside its section, so the glow shader's extra taps are only ever paid
for on screen. Underneath it sits a real `<img>`, visible by default and hidden
only once the texture has actually loaded.

The glow is two effects: a **high-pass twinkle** (each sparkle pulses on its
own hashed phase, so they glint out of step) and a **thresholded bloom** that
breathes. Both achromatic — the page's only colour is still the split.

### The plane is full bleed everywhere except act IV

Act IV is the **only** act allowed to move the plane off full bleed. That
invariant is asserted in three places rather than implied, because a scrub lags
the scroll and any of them can be interrupted:

- the act IV timeline starts and ends at full bleed
- `onLeave` / `onLeaveBack` on act IV release the box
- the `refresh` listener forces full bleed whenever act IV is not the owner

Without the third, a refresh sweep leaves the film stranded in act IV's small
frame, because no other act owns the box and nothing puts it back.

## Behaviour

| | |
|---|---|
| Preloader | Holds on the video's real buffered progress until `canplaythrough` **and** a rendered frame. Never a timed fake. |
| Sound | Starts muted, because muted is the only way a browser will autoplay. The header control is opt-in — the click that enables it is the gesture that makes unmuting legal. Enabling sound on a stopped film starts it, since silent "sound on" reads as broken. |
| Playback state | The controls track **intent**, not the element's `paused` flag. Hiding the tab stops the element (so audio doesn't play on into a tab nobody is looking at) without flipping the labels. |
| `prefers-reduced-motion` | No Lenis, no pins, no scrubbing; distortion is compiled out of the shader with a `REDUCED` define and the grain stops moving. The film starts on a still frame and the header offers Play. Every act stays readable. |
| Mobile (<768px) | The tile grid and the focus blur are compiled out (`MOBILE`), grain is reduced, and the booth's glow rings drop from 6 taps to 4. |
| Narrow viewports | Cover crops a 16:9 source past usefulness on a phone, so the fit eases toward contain — driven by how severe the crop is, not by a breakpoint. No bars appear, because out-of-frame is masked to the page's own black. |
| Contrast | Measured against the brightest rendered frames rather than assumed: grounding gradient, local blurred plates, and a text halo. Worst *single pixel* under every block clears AA, and all but the cold-open headline clear AAA. |
| Performance | DPR capped at 2; render loop stops on `visibilitychange` and when the canvas leaves the viewport via IntersectionObserver. |
| Teardown | `dispose()` kills triggers and tweens, disposes geometry/materials/textures, drops the renderer's context and removes the video element. Wired to `pagehide` and HMR. |

`?reduced` forces the reduced path in dev, and `window.__carousel` exposes the
scene for frame grabs. Both are stripped from production builds.
