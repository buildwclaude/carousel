import './styles/main.css';

import Scene from './gl/Scene.js';
import VideoPlane from './gl/VideoPlane.js';
import ImagePlane from './gl/ImagePlane.js';
import createPreloader from './ui/preloader.js';
import createScroll, { gsap, ScrollTrigger } from './animation/scroll.js';
import { buildIntro, buildActs, watchScrollCue } from './animation/timelines.js';

const VIDEO_SRC = `${import.meta.env.BASE_URL}carousel.mp4`;
const SHOP_SRC = `${import.meta.env.BASE_URL}shop.jpg`;
const MOBILE_BREAKPOINT = 768;

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  // dev affordance: ?reduced lets the reduced path be exercised without
  // changing an OS setting. Never present in a production build.
  (import.meta.env.DEV && new URLSearchParams(location.search).has('reduced'));

/** Waits for a decoded frame to actually exist, with a hard ceiling so a
 *  blocked autoplay can never strand the preloader. */
function firstFrame(video, timeout = 2500) {
  const decoded = new Promise((resolve) => {
    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(() => resolve());
      return;
    }
    const tick = () => (video.currentTime > 0 ? resolve() : requestAnimationFrame(tick));
    tick();
  });
  return Promise.race([decoded, new Promise((r) => setTimeout(r, timeout))]);
}

/**
 * Both header controls, sharing one sync pass.
 *
 * Playback tracks *intent* rather than the element's own paused flag, so
 * hiding the tab (which stops the element) never flips the label. Sound starts
 * off because muted is the only way a browser will autoplay at all — the click
 * that turns it on is the user gesture that makes unmuting legal, so this can
 * only ever exist as an opt-in.
 */
function wireControls(plane, startPaused) {
  const playBtn = document.getElementById('motion-toggle');
  const playLabel = document.getElementById('motion-toggle-label');
  const soundBtn = document.getElementById('sound-toggle');
  const soundLabel = document.getElementById('sound-toggle-label');
  if (!playBtn || !soundBtn) return () => {};

  const sync = () => {
    const paused = plane.paused;
    playBtn.setAttribute('aria-pressed', String(paused));
    playLabel.textContent = paused ? 'Play' : 'Pause';
    playBtn.setAttribute('aria-label', paused ? 'Play the film' : 'Pause the film');

    const muted = plane.muted;
    soundBtn.setAttribute('aria-pressed', String(muted));
    soundLabel.textContent = muted ? 'Sound' : 'Mute';
    soundBtn.setAttribute('aria-label', muted ? 'Turn the sound on' : 'Mute the sound');
  };

  const onPlay = () => {
    if (plane.paused) plane.play(); else plane.pause();
    sync();
  };
  // unmuting can start the film, so both labels are refreshed either way
  const onSound = () => { plane.setMuted(!plane.muted); sync(); };

  playBtn.addEventListener('click', onPlay);
  soundBtn.addEventListener('click', onSound);
  plane.video.addEventListener('volumechange', sync);

  if (startPaused) plane.pause();
  sync();

  return () => {
    playBtn.removeEventListener('click', onPlay);
    soundBtn.removeEventListener('click', onSound);
    plane.video.removeEventListener('volumechange', sync);
  };
}

/** In-page anchors have to go through Lenis, or scroll position and
 *  ScrollTrigger immediately disagree. */
function wireAnchors(scroll) {
  const onClick = (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href');
    if (id.length < 2) return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    if (scroll.lenis) scroll.lenis.scrollTo(target, { offset: 0, duration: 1.4 });
    else target.scrollIntoView({ behavior: 'auto', block: 'start' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}

async function boot() {
  const reduced = prefersReduced();
  const mobile = window.innerWidth < MOBILE_BREAKPOINT;

  // One source of truth for the reduced decision, so the stylesheet and the
  // timelines can never disagree about which experience is running.
  document.documentElement.classList.toggle('is-reduced', reduced);

  const preloader = createPreloader();
  const canvas = document.getElementById('gl');

  const scene = new Scene(canvas);
  const plane = new VideoPlane({ src: VIDEO_SRC, reduced, mobile });
  scene.add(plane);

  const imagePlane = new ImagePlane({ src: SHOP_SRC, mobile });
  scene.add(imagePlane);
  imagePlane.follow(document.getElementById('ring-frame'));

  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');

  // Dev-only handle for driving the film by hand (frame grabs, scrub checks).
  // The DEV guard strips it from production builds.
  if (import.meta.env.DEV) window.__carousel = { scene, plane, imagePlane, gsap, ScrollTrigger };

  const teardown = [];

  /* The booth is a tenth the size of the film, so it rides along on the film's
     progress rather than competing for the bar. It is also non-fatal: if it
     never arrives the <img> fallback in that section simply stays visible. */
  const shopReady = imagePlane.load()
    .then(() => { document.documentElement.classList.add('gl-ready'); })
    .catch((err) => { console.warn('[carousel] booth image unavailable:', err.message); });

  try {
    await plane.load((p) => preloader.setProgress(p));
  } catch (err) {
    preloader.fail(
      'The film could not be loaded. All eight sections are written out below and remain readable.'
    );
    document.body.classList.remove('is-loading');
    console.error(err);
    return;
  }

  // Under reduced motion the film starts on a still frame; the toggle in the
  // header starts it. Everywhere else it plays.
  if (!reduced) plane.play();
  await firstFrame(plane.video);

  await shopReady;

  // A frame exists in the back buffer before the loader is allowed to lift.
  scene.renderOnce(0, 0);

  const scroll = createScroll({
    reduced,
    onVelocity: (v) => plane.setVelocity(v),
  });
  teardown.push(scroll.destroy);
  teardown.push(wireAnchors(scroll));
  teardown.push(wireControls(plane, reduced));
  if (!reduced) teardown.push(watchScrollCue());

  // One clock for everything: Lenis, ScrollTrigger, GSAP and the renderer.
  const tick = (time, deltaMs) => scene.render(time, deltaMs / 1000);
  gsap.ticker.add(tick);
  teardown.push(() => gsap.ticker.remove(tick));

  teardown.push(buildActs({ plane, imagePlane, reduced, mobile }));

  // The loader unhides the page as it starts fading, so the intro plays under
  // it rather than after it — one continuous hand-off, not two beats.
  preloader.reveal();
  buildIntro({ plane, reduced });

  // Layout is only final once the fonts have landed.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }

  // The renderer resizes on its own debounce; the triggers must follow it.
  const onResize = debounce(() => ScrollTrigger.refresh(), 200);
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  teardown.push(() => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  });

  const dispose = () => {
    teardown.forEach((fn) => { try { fn(); } catch { /* already gone */ } });
    gsap.globalTimeline.clear();
    scene.dispose();
  };

  window.addEventListener('pagehide', dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);

  if (import.meta.env.DEV) Object.assign(window.__carousel, { scroll, dispose });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

boot();
