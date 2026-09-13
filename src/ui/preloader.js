import gsap from 'gsap';

/**
 * A real progress indicator: the bar is driven by the video's own buffered
 * range, never by a timer pretending to be one. It holds until the video can
 * play through *and* a first frame has actually been rendered.
 */
export default function createPreloader() {
  const root = document.getElementById('preloader');
  const fill = document.getElementById('preloader-fill');
  const pct = document.getElementById('preloader-pct');

  document.body.classList.add('is-loading');

  const state = { p: 0, shown: 0 };
  let max = 0;

  const paint = () => {
    gsap.set(fill, { scaleX: state.shown });
    pct.textContent = String(Math.round(state.shown * 100)).padStart(2, '0');
  };
  paint();

  return {
    /** Monotonic: a buffered range that shrinks must not walk the bar back. */
    setProgress(p) {
      max = Math.max(max, Math.min(1, Math.max(0, p)));
      if (max <= state.p) return;
      state.p = max;
      gsap.to(state, {
        shown: max,
        duration: 0.65,
        ease: 'power2.out',
        onUpdate: paint,
        overwrite: true,
      });
    },

    fail(message) {
      root.querySelector('.preloader__label').textContent = 'Unavailable';
      pct.textContent = '!!';
      const note = document.createElement('p');
      note.className = 'mono';
      note.style.cssText = 'position:absolute;bottom:4.5rem;left:0;color:rgba(244,241,236,.5);max-width:42ch;line-height:1.7;text-transform:none;letter-spacing:.04em';
      note.textContent = message;
      root.querySelector('.preloader__inner').appendChild(note);
    },

    /** Hand over to the film. Resolves when the loader is gone from the DOM. */
    reveal() {
      return new Promise((resolve) => {
        // content is unhidden first, so the intro plays *under* the loader
        // as it fades rather than after it
        document.body.classList.remove('is-loading');
        const tl = gsap.timeline({
          onComplete: () => { root.remove(); resolve(); },
        });
        tl.to(state, { shown: 1, duration: 0.35, ease: 'power2.out', onUpdate: paint })
          .to('.preloader__inner', { autoAlpha: 0, y: -12, duration: 0.7, ease: 'power2.inOut' }, 0.2)
          .to(root, { autoAlpha: 0, duration: 0.9, ease: 'power2.inOut' }, 0.45);
      });
    },
  };
}
