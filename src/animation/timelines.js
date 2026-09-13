import { gsap, ScrollTrigger } from './scroll.js';

/* Weighted easing throughout. Things settle; nothing bounces. */
const E_SETTLE = 'expo.out';
const E_MOVE = 'power2.inOut';

/* Every act timeline runs on a normalised 0..1 clock, so a position written
   here is literally "x of the way through this act's scroll". */
const ACT_DEFAULTS = { duration: 1, ease: 'none', overwrite: 'auto' };

/* A fromTo stamps its start state onto the target the moment it is built
   unless told not to — five acts building in sequence would leave act V's
   opening state on screen during act I. It has to be set per tween;
   immediateRender is not inherited through a timeline's `defaults`. */
const LAZY = { immediateRender: false };

/* The state of the film at the end of each act, written out explicitly so a
   scrub can run backwards through them and land on exactly the same numbers. */
const STATE = {
  1: { zoom: 1.12, focus: 0.10, contrast: 0.46, exposure: 0.74, vignette: 0.64, darken: 0.00, aberration: 1.8 },
  2: { zoom: 1.00, focus: 1.00, contrast: 1.20, exposure: 1.00, vignette: 0.48, darken: 0.00, aberration: 1.0 },
  3: { zoom: 1.03, focus: 1.00, contrast: 1.32, exposure: 1.04, vignette: 0.44, darken: 0.00, aberration: 1.0 },
  4: { zoom: 1.00, focus: 1.00, contrast: 1.26, exposure: 1.02, vignette: 0.26, darken: 0.00, aberration: 0.7 },
  5: { zoom: 1.09, focus: 1.00, contrast: 1.10, exposure: 0.92, vignette: 0.70, darken: 0.62, aberration: 1.4 },
};

/* ------------------------------------------------------------------ boxes */

const vw = () => window.innerWidth;
const vh = () => window.innerHeight;

const fullBleed = () => ({ x: 0, y: 0, w: vw(), h: vh() });

/* Act IV: measured off the DOM frame, so GL and layout can never disagree.
   Measured relative to the pin container, which is exactly viewport space
   once the section is pinned. */
const frameBox = (section) => {
  const pin = section.querySelector('.act__pin');
  const frame = section.querySelector('.split__frame');
  if (!pin || !frame) return fullBleed();
  const p = pin.getBoundingClientRect();
  const f = frame.getBoundingClientRect();
  if (!f.width || !f.height) return fullBleed();
  return { x: f.left - p.left, y: f.top - p.top, w: f.width, h: f.height };
};

/* ------------------------------------------------------------- text utils */

/** Wraps each character in a span, keeping words unbreakable. */
export function splitChars(el) {
  if (!el || el.dataset.split === 'done') return [];
  const text = el.textContent;
  el.textContent = '';
  const chars = [];
  for (const token of text.split(/(\s+)/)) {
    if (token === '') continue;
    if (/^\s+$/.test(token)) { el.appendChild(document.createTextNode(token)); continue; }
    const word = document.createElement('span');
    word.className = 'word';
    for (const ch of token) {
      const c = document.createElement('span');
      c.className = 'char';
      c.textContent = ch;
      word.appendChild(c);
      chars.push(c);
    }
    el.appendChild(word);
  }
  el.dataset.split = 'done';
  el.setAttribute('aria-label', text);
  return chars;
}

const q = (root, sel) => Array.from(root.querySelectorAll(sel));

/* ------------------------------------------------------------------ intro */

/**
 * Fires once, after the preloader has handed over and a first frame exists.
 * Not scroll-linked: this is the film starting, not the film being scrubbed.
 */
export function buildIntro({ plane, reduced }) {
  const act1 = document.querySelector('.act--1');
  const tl = gsap.timeline({ defaults: { ease: E_SETTLE } });

  gsap.set('.chrome', { autoAlpha: 0 });
  gsap.set(q(act1, '.line__in'), { yPercent: 108 });
  gsap.set(q(act1, '[data-fade]'), { autoAlpha: 0, y: 14 });
  gsap.set('#scroll-cue', { autoAlpha: 0 });

  if (reduced) {
    // opacity only — nothing translates
    tl.set([...q(act1, '.line__in'), ...q(act1, '[data-fade]')], { yPercent: 0, y: 0 })
      .to(['.chrome', ...q(act1, '[data-fade]'), '#scroll-cue'],
        { autoAlpha: 1, duration: 0.6 });
    return tl;
  }

  tl.fromTo(plane.uniforms.uOpacity, { value: 0 }, { value: 1, duration: 1.4, ease: 'power2.out' }, 0)
    .fromTo(plane.uniforms.uZoom,
      { value: 1.34 }, { value: STATE[1].zoom, duration: 2.6, ease: 'power3.out' }, 0)
    .fromTo(plane.uniforms.uFocus,
      { value: 0 }, { value: STATE[1].focus, duration: 2.2, ease: 'power2.out' }, 0.1)
    .to(q(act1, '.line__in'), { yPercent: 0, duration: 1.5, stagger: 0.08 }, 0.45)
    .to(q(act1, '[data-fade]'), { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.1 }, 1.1)
    .to('.chrome', { autoAlpha: 1, duration: 1.0 }, 1.2)
    .to('#scroll-cue', { autoAlpha: 1, duration: 0.9 }, 1.5);

  return tl;
}

/** The cue has done its job the moment the user answers it. */
export function watchScrollCue() {
  const cue = document.getElementById('scroll-cue');
  if (!cue) return () => {};
  const events = ['wheel', 'touchstart', 'keydown', 'scroll'];
  const dismiss = () => {
    gsap.to(cue, { autoAlpha: 0, duration: 0.5, ease: 'power2.out' });
    off();
  };
  const off = () => events.forEach((e) => window.removeEventListener(e, dismiss));
  events.forEach((e) => window.addEventListener(e, dismiss, { passive: true, once: true }));
  return off;
}

/* ----------------------------------------------------- reduced-motion path */

/**
 * No pinning, no scrubbing, no scroll-coupled shader input. Each act fades its
 * own copy in and the film settles on a single, legible state.
 */
function buildReduced({ plane }) {
  const u = plane.uniforms;
  u.uZoom.value = 1.0;
  u.uFocus.value = 1.0;
  u.uContrast.value = 1.2;
  u.uExposure.value = 1.0;
  u.uVignette.value = 0.5;
  u.uFragment.value = 0.0;
  u.uAberration.value = 0.6;
  // The film is still here and stays full bleed under every line of copy, so
  // it sits back a little further than it does in the scrolled experience.
  u.uDarken.value = 0.22;
  plane.setFullBleed();

  const chars = splitChars(document.querySelector('[data-chars]'));
  gsap.set(chars, { autoAlpha: 0 });

  q(document, '.act:not(.act--1)').forEach((section) => {
    const items = [...q(section, '[data-fade], [data-spec], .line__in'),
      ...q(section, '.char')];
    gsap.set(items, { autoAlpha: 0 });
    ScrollTrigger.create({
      trigger: section,
      start: 'top 72%',
      once: true,
      onEnter: () => gsap.to(items, {
        autoAlpha: 1, duration: 0.7,
        stagger: Math.min(0.05, 1.2 / Math.max(items.length, 1)),
        ease: 'power2.out',
      }),
    });
  });

  gsap.set('.split__frame', { autoAlpha: 1 });

  // one gentle darkening for the close, so the last line stays readable
  ScrollTrigger.create({
    trigger: '.act--5',
    start: 'top 60%',
    once: true,
    onEnter: () => gsap.to(u.uDarken, { value: 0.58, duration: 1.0, ease: 'power2.out' }),
  });
}

/* --------------------------------------------------- reading sections ---- */

/**
 * The long-form sections are not pinned and not scrubbed. They are what the
 * scroll is actually for, so they move at reading speed and simply settle in.
 */
function buildReadingSections({ reduced }) {
  q(document, '.read').forEach((section) => {
    const items = q(section, '[data-fade]');
    if (!items.length) return;
    gsap.set(items, { autoAlpha: 0, y: reduced ? 0 : 18 });
    ScrollTrigger.create({
      trigger: section,
      start: 'top 78%',
      once: true,
      onEnter: () => gsap.to(items, {
        autoAlpha: 1, y: 0,
        duration: reduced ? 0.6 : 1.0,
        stagger: 0.07,
        ease: E_SETTLE,
      }),
    });
  });
}

/* ------------------------------------------------------------- the 5 acts */

/** Returns a teardown for the listeners it registers outside the trigger set. */
export function buildActs({ plane, reduced = false, mobile = false }) {
  buildReadingSections({ reduced });
  if (reduced) { buildReduced({ plane }); return () => {}; }

  const u = plane.uniforms;

  /* The plane is full bleed for the whole film except act IV, which is the
     only act allowed to move it. Keeping that invariant in one place is what
     stops the film getting stranded in a small box when a scrub is
     interrupted mid-transition.

     The box is tweened through a proxy; every write lands on the plane. Both
     ends are function-based so invalidateOnRefresh can re-measure. */
  const box = { ...fullBleed() };
  const applyBox = () => plane.setBox(box.x, box.y, box.w, box.h);
  const boxVars = (fn) => ({ x: () => fn().x, y: () => fn().y, w: () => fn().w, h: () => fn().h });
  const boxTo = (fn, vars = {}) => ({ ...boxVars(fn), onUpdate: applyBox, ...LAZY, ...vars });

  const acts = [];
  let framed = null;          // the one act allowed to move the plane
  const act = (n) => document.querySelector(`.act--${n}`);
  const pinned = (n, end, extra = {}) => ({
    scrollTrigger: {
      trigger: act(n),
      start: 'top top',
      end,
      pin: act(n).querySelector('.act__pin'),
      pinSpacing: true,
      scrub: 0.85,
      invalidateOnRefresh: true,
      anticipatePin: 1,
      /* Pins add spacing, which moves everything below them down. The reading
         sections are created before these, so without an explicit priority
         they measure against a pre-pin layout and land thousands of pixels
         off — the booth's section would then be "past" before you reach it,
         and it would never draw. Higher refreshes first; descending by
         document order keeps the pins themselves in sequence. */
      refreshPriority: 10 - n,
      ...extra,
    },
    defaults: ACT_DEFAULTS,
  });

  /** uniform A -> B across the whole act unless a duration is given */
  const uni = (from, to, vars = {}) => [{ value: from }, { value: to, ...LAZY, ...vars }];

  /** register an act timeline in scroll order */
  const keep = (tl) => { acts.push(tl.scrollTrigger); return tl; };

  /* --- I. Cold open, handing over to II --------------------------------- */
  {
    const s = act(1);
    const tl = keep(gsap.timeline(pinned(1, '+=80%')));

    tl.fromTo(u.uZoom, ...uni(STATE[1].zoom, STATE[2].zoom), 0)
      .fromTo(u.uFocus, ...uni(STATE[1].focus, STATE[2].focus), 0)
      .fromTo(u.uContrast, ...uni(STATE[1].contrast, STATE[2].contrast), 0)
      .fromTo(u.uExposure, ...uni(STATE[1].exposure, STATE[2].exposure), 0)
      .fromTo(u.uVignette, ...uni(STATE[1].vignette, STATE[2].vignette), 0)
      .fromTo(u.uAberration, ...uni(STATE[1].aberration, STATE[2].aberration), 0)
      .to(q(s, '.display'), { yPercent: -14, autoAlpha: 0, duration: 0.45, ease: 'power1.in' }, 0.3)
      .to(q(s, '.act__lede, .act__index'), { autoAlpha: 0, y: -10, duration: 0.35 }, 0.3);
  }

  /* --- II. The reveal --------------------------------------------------- */
  {
    const s = act(2);
    const index = q(s, '.act__index--float');
    const specs = q(s, '[data-spec]');
    const caption = q(s, '[data-fade]').filter((el) => !index.includes(el));

    gsap.set([...index, ...specs, ...caption], { autoAlpha: 0, y: 16 });

    const tl = keep(gsap.timeline(pinned(2, '+=90%')));

    tl.to([...index, ...specs],
        { autoAlpha: 1, y: 0, duration: 0.22, stagger: 0.04, ease: 'power2.out' }, 0.02)
      .to(caption, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out' }, 0.2)
      .fromTo(u.uContrast, ...uni(STATE[2].contrast, STATE[3].contrast, { duration: 0.45 }), 0.3)
      .fromTo(u.uExposure, ...uni(STATE[2].exposure, STATE[3].exposure, { duration: 0.45 }), 0.3)
      .fromTo(u.uVignette, ...uni(STATE[2].vignette, STATE[3].vignette, { duration: 0.45 }), 0.3)
      .fromTo(u.uZoom, ...uni(STATE[2].zoom, STATE[3].zoom, { duration: 0.4 }), 0.4)
      .to([...index, ...specs, ...caption],
        { autoAlpha: 0, y: -14, duration: 0.2, stagger: 0.02 }, 0.8);
  }

  /* --- III. Fragment — the centrepiece ---------------------------------- */
  {
    const s = act(3);
    const lines = q(s, '.line__in');
    const fades = q(s, '[data-fade]');

    gsap.set(lines, { yPercent: 108 });
    gsap.set(fades, { autoAlpha: 0, y: 16 });

    const tl = keep(gsap.timeline(pinned(3, mobile ? '+=120%' : '+=160%')));

    tl.to(lines, { yPercent: 0, duration: 0.2, stagger: 0.05, ease: E_SETTLE }, 0)
      .to(fades, { autoAlpha: 1, y: 0, duration: 0.18, stagger: 0.04, ease: 'power2.out' }, 0.1);

    if (mobile) {
      // the grid is compiled out of the shader on mobile; the act keeps its
      // beat through tone and scale instead of tiles
      tl.fromTo(u.uZoom, ...uni(STATE[3].zoom, 1.16, { duration: 0.34 }), 0.14)
        .to(u.uZoom, { value: STATE[4].zoom, duration: 0.36 }, 0.48)
        .fromTo(u.uContrast, ...uni(STATE[3].contrast, 1.55, { duration: 0.34 }), 0.14)
        .to(u.uContrast, { value: STATE[4].contrast, duration: 0.36 }, 0.48);
    } else {
      // apart, held, and back together — the tiles never simply cut
      tl.fromTo(u.uFragment, ...uni(0, 1, { duration: 0.32, ease: 'power2.in' }), 0.14)
        .to(u.uFragment, { value: 0.86, duration: 0.12, ease: 'sine.inOut' }, 0.46)
        .to(u.uFragment, { value: 0, duration: 0.26, ease: 'power3.out' }, 0.58)
        .fromTo(u.uZoom, ...uni(STATE[3].zoom, 1.14, { duration: 0.34 }), 0.14)
        .to(u.uZoom, { value: STATE[4].zoom, duration: 0.36 }, 0.48)
        .fromTo(u.uContrast, ...uni(STATE[3].contrast, 1.6, { duration: 0.34 }), 0.14)
        .to(u.uContrast, { value: STATE[4].contrast, duration: 0.36 }, 0.48)
        .fromTo(u.uAberration, ...uni(STATE[3].aberration, 2.4, { duration: 0.3 }), 0.16)
        .to(u.uAberration, { value: STATE[4].aberration, duration: 0.34 }, 0.5);
    }

    tl.fromTo(u.uVignette, ...uni(STATE[3].vignette, STATE[4].vignette, { duration: 0.35 }), 0.5)
      .fromTo(u.uExposure, ...uni(STATE[3].exposure, STATE[4].exposure, { duration: 0.35 }), 0.5)
      .to(lines, { yPercent: -108, duration: 0.14, stagger: 0.03, ease: 'power2.in' }, 0.86)
      .to(fades, { autoAlpha: 0, y: -14, duration: 0.14 }, 0.86);
  }

  /* --- IV. Framed ------------------------------------------------------- */
  {
    const s = act(4);
    const chars = splitChars(s.querySelector('[data-chars]'));
    const fades = q(s, '[data-fade]');
    const frameOf = () => frameBox(s);

    gsap.set(chars, { yPercent: 105, autoAlpha: 0 });
    gsap.set(fades, { autoAlpha: 0, y: 18 });
    gsap.set('.split__frame', { autoAlpha: 0 });
    gsap.set('.split__rule', { scaleX: 0 });

    /* The scrub lags the scroll by design, so leaving this act quickly can
       otherwise strand the plane mid-transition — a small box floating on a
       black page with nothing to put it back. Both edges are already full
       bleed in the timeline, so asserting it here costs no visible snap. */
    const releaseBox = () => plane.setFullBleed();

    const tl = keep(gsap.timeline(pinned(4, '+=130%', {
      onLeave: releaseBox,
      onLeaveBack: releaseBox,
    })));
    framed = tl.scrollTrigger;

    tl.fromTo(box, boxVars(fullBleed), boxTo(frameOf, { duration: 0.35, ease: E_MOVE }), 0)
      .to('.split__frame', { autoAlpha: 1, duration: 0.15 }, 0.2)
      .to('.split__rule', { scaleX: 1, duration: 0.28, ease: E_SETTLE }, 0.28)
      .to(chars, { yPercent: 0, autoAlpha: 1, duration: 0.3, stagger: 0.006, ease: E_SETTLE }, 0.22)
      .to(fades, { autoAlpha: 1, y: 0, duration: 0.26, stagger: 0.04, ease: 'power2.out' }, 0.34)
      // and out, continuously, into the close
      .to([...fades, ...chars], { autoAlpha: 0, y: -12, duration: 0.14, stagger: 0.003 }, 0.82)
      .to('.split__frame', { autoAlpha: 0, duration: 0.12 }, 0.84)
      .fromTo(box, boxVars(frameOf), boxTo(fullBleed, { duration: 0.18, ease: E_MOVE }), 0.82);
  }

  /* --- V. Close --------------------------------------------------------- */
  {
    const s = act(5);
    const lines = q(s, '.line__in');
    const fades = q(s, '[data-fade]');

    gsap.set(lines, { yPercent: 108 });
    gsap.set(fades, { autoAlpha: 0, y: 14 });

    const tl = keep(gsap.timeline(pinned(5, '+=70%')));

    tl.fromTo(u.uDarken, ...uni(STATE[4].darken, STATE[5].darken), 0)
      .fromTo(u.uZoom, ...uni(STATE[4].zoom, STATE[5].zoom), 0)
      .fromTo(u.uVignette, ...uni(STATE[4].vignette, STATE[5].vignette), 0)
      .fromTo(u.uContrast, ...uni(STATE[4].contrast, STATE[5].contrast), 0)
      .fromTo(u.uExposure, ...uni(STATE[4].exposure, STATE[5].exposure), 0)
      .fromTo(u.uAberration, ...uni(STATE[4].aberration, STATE[5].aberration), 0)
      .to(fades, { autoAlpha: 1, y: 0, duration: 0.2, ease: 'power2.out' }, 0.18)
      .to(lines, { yPercent: 0, duration: 0.3, stagger: 0.1, ease: E_SETTLE }, 0.24);
  }

  /* Five scrubbed timelines share one set of uniforms, and a refresh sweeps
     every one of them forward and back to measure — so whichever act was
     refreshed last leaves its state on screen, no matter where the reader
     actually is. After any refresh, re-render the act that genuinely owns the
     current scroll position, last. */
  const syncActs = () => {
    const owner =
      acts.find((t) => t.progress > 0 && t.progress < 1) ||
      [...acts].reverse().find((t) => t.progress >= 1) ||
      acts[0];
    if (!owner?.animation) return;
    const p = owner.animation.progress();
    owner.animation.progress(p === 0 ? 1 : 0).progress(p);

    /* Re-rendering the owner restores every uniform it owns, but the plane's
       box belongs to act IV alone — so no other act can put it back, and a
       refresh sweep would otherwise leave the film stranded in act IV's small
       frame. The invariant is asserted here rather than implied. */
    if (owner !== framed) plane.setFullBleed();
  };

  ScrollTrigger.addEventListener('refresh', syncActs);
  ScrollTrigger.refresh();

  return () => ScrollTrigger.removeEventListener('refresh', syncActs);
}
