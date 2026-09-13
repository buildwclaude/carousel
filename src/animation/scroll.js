import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

// Lenis reports px/frame; this maps a hard flick to roughly 1.0.
const VELOCITY_SCALE = 1 / 48;
const VELOCITY_CLAMP = 1.6;

/**
 * Lenis <-> ScrollTrigger <-> GSAP ticker, wired as one clock.
 *
 * Under prefers-reduced-motion Lenis is never constructed at all — native
 * scrolling is left exactly as the user's OS intends it, and velocity is
 * pinned to zero so nothing reaches the shader.
 */
export default function createScroll({ reduced = false, onVelocity } = {}) {
  if (reduced) {
    return {
      lenis: null,
      stop() {},
      start() {},
      destroy() { ScrollTrigger.getAll().forEach((t) => t.kill()); },
    };
  }

  const lenis = new Lenis({
    duration: 1.15,
    // weighted easing: it settles, it does not bounce
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    syncTouch: false,
    touchMultiplier: 1.35,
    wheelMultiplier: 0.95,
  });

  lenis.on('scroll', ScrollTrigger.update);

  const raf = (time) => {
    lenis.raf(time * 1000);
    if (onVelocity) {
      const v = gsap.utils.clamp(
        -VELOCITY_CLAMP, VELOCITY_CLAMP, (lenis.velocity || 0) * VELOCITY_SCALE
      );
      onVelocity(v);
    }
  };

  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);

  return {
    lenis,
    stop() { lenis.stop(); },
    start() { lenis.start(); },
    destroy() {
      gsap.ticker.remove(raf);
      lenis.destroy();
      ScrollTrigger.getAll().forEach((t) => t.kill());
    },
  };
}

export { gsap, ScrollTrigger };
