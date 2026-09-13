import * as THREE from 'three';
// Shaders are hand-written GLSL loaded verbatim; no plugin, no #include graph.
import vertexShader from './shaders/video.vert?raw';
import fragmentShader from './shaders/video.frag?raw';

const damp = (current, target, lambda, delta) =>
  current + (target - current) * (1 - Math.exp(-lambda * delta));

/**
 * The full-screen plane, its ShaderMaterial, and the two inputs that have to
 * be smoothed before they ever touch a uniform: scroll velocity and pointer
 * position. Nothing here snaps — raw deltas are held as *targets* and the
 * uniform is damped toward them every frame.
 */
export default class VideoPlane {
  constructor({ src, reduced = false, mobile = false }) {
    this.reduced = reduced;
    this.mobile = mobile;

    this.video = this._createVideo(src);

    /* The tonal chain inverts, so an *empty* texture would read as paper white
       and flash the whole viewport. The placeholder is white for exactly that
       reason: unloaded and inverted, it resolves to the page's own black. */
    this.placeholder = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat
    );
    this.placeholder.needsUpdate = true;

    this.texture = new THREE.VideoTexture(this.video);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;

    this.uniforms = {
      uTexture:    { value: this.placeholder },
      uPlaneSize:  { value: new THREE.Vector2(1, 1) },
      uTexSize:    { value: new THREE.Vector2(1280, 720) },
      uGridSize:   { value: new THREE.Vector2(10, 6) },
      uMouse:      { value: new THREE.Vector2(0, 0) },

      uTime:       { value: 0 },
      uVelocity:   { value: 0 },
      uZoom:       { value: 1.12 },   // act I opens slightly over-scaled
      uFit:        { value: 1.0 },
      uFocus:      { value: 0.0 },
      uContrast:   { value: 0.46 },
      uExposure:   { value: 0.74 },
      uPivot:      { value: 0.13 },
      uInvert:     { value: 1.0 },
      uFragment:   { value: 0.0 },
      uGrain:      { value: mobile ? 0.035 : 0.055 },
      uVignette:   { value: 0.64 },
      uAberration: { value: 1.8 },
      uRefraction: { value: reduced ? 0.0 : 1.0 },
      uDarken:     { value: 0.0 },
      // 1.0, not 0: the intro tween pulls it down to 0 and lifts it, so a page
      // that never gets its intro shows the film rather than a black void.
      uOpacity:    { value: 1.0 },
    };

    const defines = {};
    if (mobile) defines.MOBILE = '';
    if (reduced) defines.REDUCED = '';

    this.geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      defines,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    // px box the plane currently occupies; full viewport until told otherwise
    this.viewport = { w: 0, h: 0, dpr: 1 };
    this.box = { x: 0, y: 0, w: 1, h: 1 };

    /* three's VideoTexture only marks itself dirty from requestVideoFrameCallback,
       which never fires while the video is paused — so a paused film would never
       reach the GPU at all. Track it and upload one frame by hand when needed. */
    this._needsFrame = true;
    const dirty = () => { this._needsFrame = true; };
    this._videoEvents = ['loadeddata', 'seeked', 'pause', 'play', 'canplaythrough'];
    this._videoEvents.forEach((e) => this.video.addEventListener(e, dirty));
    this._markDirty = dirty;

    // what the reader asked for, independent of what the element is doing
    this._intentPlaying = false;

    /* A hidden tab stops the render loop, but the element would keep decoding
       and — now that the source carries audio — keep playing it out loud.
       Stop it, and restore only what the reader actually asked for. */
    this._onDocVisibility = () => {
      if (document.visibilityState === 'hidden') this.video.pause();
      else if (this._intentPlaying) this._resume();
    };
    document.addEventListener('visibilitychange', this._onDocVisibility);

    this._velocityTarget = 0;
    this._mouseTarget = new THREE.Vector2(0, 0);
    this._pointerPx = null;

    this._onPointer = this._onPointer.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);

    if (!reduced && window.matchMedia('(pointer: fine)').matches) {
      window.addEventListener('pointermove', this._onPointer, { passive: true });
      window.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
    }
  }

  _createVideo(src) {
    const v = document.createElement('video');
    v.src = src;
    v.muted = true;            // non-negotiable: browsers block unmuted autoplay
    v.defaultMuted = true;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    // kept in the document (iOS will not decode a fully detached element)
    // but out of the layout and out of the a11y tree
    Object.assign(v.style, {
      position: 'fixed', top: '0', left: '0',
      width: '1px', height: '1px',
      opacity: '0', pointerEvents: 'none', zIndex: '-1',
    });
    document.body.appendChild(v);
    return v;
  }

  /**
   * Resolves once the video can play through AND its intrinsic size is known.
   * onProgress reports genuine buffered-bytes progress, not a timed fake.
   */
  load(onProgress) {
    const v = this.video;

    const report = () => {
      let p = 0;
      if (v.duration && v.buffered.length) {
        p = v.buffered.end(v.buffered.length - 1) / v.duration;
      }
      if (v.readyState >= 4) p = 1;
      onProgress?.(Math.max(0, Math.min(1, p)));
    };

    return new Promise((resolve, reject) => {
      const done = () => {
        cleanup();
        this.uniforms.uTexSize.value.set(v.videoWidth || 1280, v.videoHeight || 720);
        this._applyBox();  // the fit depends on the now-known source aspect
        // only now is there something real to sample
        this.uniforms.uTexture.value = this.texture;
        this._needsFrame = true;
        onProgress?.(1);
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error(`Could not load ${v.currentSrc || v.src}`));
      };
      const cleanup = () => {
        v.removeEventListener('canplaythrough', done);
        v.removeEventListener('error', fail);
        v.removeEventListener('progress', report);
        v.removeEventListener('loadedmetadata', report);
        clearInterval(timer);
      };

      v.addEventListener('canplaythrough', done, { once: true });
      v.addEventListener('error', fail, { once: true });
      v.addEventListener('progress', report);
      v.addEventListener('loadedmetadata', report);

      // `progress` can go quiet on a fast connection; poll as a floor
      const timer = setInterval(report, 120);

      // Setting .src in the constructor already began the load; only nudge the
      // element if it somehow has not started. Calling load() unconditionally
      // would reset an already-buffered element and blank the first frame on a
      // warm reload.
      if (v.networkState === HTMLMediaElement.NETWORK_EMPTY) v.load();
      if (v.readyState >= 4) done();
    });
  }

  /* --- playback --------------------------------------------------------- */

  /**
   * `_intentPlaying` is what the reader asked for; `video.paused` is what the
   * element is doing right now. They diverge whenever the tab is hidden, and
   * the header control has to follow the intent, not the element, or its label
   * flips every time you switch tabs.
   */
  _resume() {
    // intent is recorded, but nothing actually starts playing out loud into a
    // tab nobody is looking at; the visibility handler picks it up on return
    if (document.visibilityState === 'hidden') return;
    const p = this.video.play();
    if (p?.catch) p.catch(() => { /* autoplay refused; first frame still shows */ });
  }

  play() {
    this._intentPlaying = true;
    this._resume();
  }

  pause() {
    this._intentPlaying = false;
    this.video.pause();
  }

  get paused() { return !this._intentPlaying; }

  /* --- sound ------------------------------------------------------------ */

  get muted() { return this.video.muted; }

  /**
   * Unmuting is only permitted from a user gesture, which is exactly where
   * this is called from. Turning the sound on with the film stopped would be
   * silent and read as broken, so it starts the film too.
   */
  setMuted(muted) {
    this.video.muted = muted;
    this.video.defaultMuted = muted;
    if (!muted && !this._intentPlaying) this.play();
  }

  /* --- layout ----------------------------------------------------------- */

  /**
   * Place the plane over a pixel box in viewport space. The orthographic
   * frustum spans [-1, 1], so one clip unit is half the viewport: scale is a
   * plain ratio and position is a plain offset. uPlaneSize follows, which is
   * what keeps cover-fit honest when the plane is not full-bleed.
   */
  setBox(x, y, w, h) {
    this.box = { x, y, w, h };
    this._applyBox();
  }

  setFullBleed() {
    const { w, h } = this.viewport;
    this.setBox(0, 0, w, h);
  }

  /** Box expressed as fractions of the viewport, so a resize can re-derive it. */
  get boxFractions() {
    const vp = this.viewport;
    if (!vp.w || !vp.h) return { x: 0, y: 0, w: 1, h: 1 };
    return {
      x: this.box.x / vp.w, y: this.box.y / vp.h,
      w: this.box.w / vp.w, h: this.box.h / vp.h,
    };
  }

  _applyBox() {
    const vp = this.viewport;
    if (!vp.w || !vp.h) return;
    const { x, y, w, h } = this.box;

    this.mesh.scale.set(w / vp.w, h / vp.h, 1);
    this.mesh.position.x = ((x + w / 2) / vp.w) * 2 - 1;
    this.mesh.position.y = 1 - ((y + h / 2) / vp.h) * 2;

    this.uniforms.uPlaneSize.value.set(w, h);
    this._applyGrid(w, h);
    this._applyFit(w, h);
  }

  /**
   * Cover is right until it isn't. A phone-shaped plane crops a 16:9 source so
   * hard that the carousel loses its silhouette entirely, so past a threshold
   * the fit eases toward contain. Driven by how severe the crop actually is,
   * not by a breakpoint, so a tall desktop window is treated the same way.
   * The shader masks anything outside the source to black, which is the page's
   * own ground — so the easing never reads as letterboxing.
   */
  _applyFit(w, h) {
    const tex = this.uniforms.uTexSize.value;
    const planeAspect = w / Math.max(h, 1);
    const texAspect = tex.x / Math.max(tex.y, 1);

    const contain = Math.min(1, planeAspect / texAspect);
    const severity = 1 - contain;              // 0 = no crop, 1 = extreme
    const t = THREE.MathUtils.smoothstep(severity, 0.5, 0.72);
    this.uniforms.uFit.value = 1 - t * 0.85 * severity;
  }

  _applyGrid(w, h) {
    // cells stay square on screen at every aspect ratio
    const rows = this.mobile ? 4 : 6;
    const cols = Math.max(2, Math.round(rows * (w / Math.max(h, 1))));
    this.uniforms.uGridSize.value.set(cols, rows);
  }

  /**
   * Hold the box's *proportions* across a resize rather than snapping back to
   * full bleed. ScrollTrigger.refresh() then re-evaluates the act timelines and
   * corrects the box exactly — this only avoids one wrong frame in between.
   */
  resize(size) {
    const prev = this.viewport.w ? this.boxFractions : null;
    this.viewport = size;
    if (prev) {
      this.setBox(prev.x * size.w, prev.y * size.h, prev.w * size.w, prev.h * size.h);
    } else {
      this.setFullBleed();
    }
  }

  /* --- inputs ----------------------------------------------------------- */

  setVelocity(v) { this._velocityTarget = v; }

  _onPointer(e) {
    this._pointerPx = { x: e.clientX, y: e.clientY };
  }

  _onPointerLeave() {
    this._pointerPx = null;
  }

  update(time, delta) {
    const d = Math.min(delta, 0.1);
    const u = this.uniforms;

    u.uTime.value = time;

    // one upload when playback is not driving them (paused, seeked, first frame)
    if (this._needsFrame && this.video.readyState >= 2) {
      this.texture.needsUpdate = true;
      this._needsFrame = false;
    }

    // The target itself bleeds toward zero, and the uniform is damped toward
    // the target. Two stages, so a flick of the wheel arrives as a swell.
    this._velocityTarget = damp(this._velocityTarget, 0, 3.4, d);
    u.uVelocity.value = damp(u.uVelocity.value, this._velocityTarget, 7.0, d);
    if (Math.abs(u.uVelocity.value) < 0.0002) u.uVelocity.value = 0;

    // pointer -> plane-local -1..1, damped
    if (this._pointerPx) {
      const { x, y, w, h } = this.box;
      this._mouseTarget.set(
        ((this._pointerPx.x - x) / Math.max(w, 1)) * 2 - 1,
        1 - ((this._pointerPx.y - y) / Math.max(h, 1)) * 2
      );
    } else {
      this._mouseTarget.set(0, 0);
    }
    u.uMouse.value.x = damp(u.uMouse.value.x, this._mouseTarget.x, 3.2, d);
    u.uMouse.value.y = damp(u.uMouse.value.y, this._mouseTarget.y, 3.2, d);
  }

  dispose() {
    window.removeEventListener('pointermove', this._onPointer);
    window.removeEventListener('pointerleave', this._onPointerLeave);
    this._videoEvents.forEach((e) => this.video.removeEventListener(e, this._markDirty));
    document.removeEventListener('visibilitychange', this._onDocVisibility);

    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();

    this.texture.dispose();
    this.placeholder.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
