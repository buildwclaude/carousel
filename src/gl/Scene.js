import * as THREE from 'three';

const RESIZE_DEBOUNCE = 140;

/**
 * Renderer, orthographic camera and the render loop.
 *
 * The camera frustum is fixed at [-1, 1] on both axes, so one unit of the
 * frustum is half the viewport. That makes the px -> clip conversion used by
 * VideoPlane.setBox() a plain division, and keeps the DOM layout and the GL
 * layout from ever drifting apart on resize.
 */
export default class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.size = { w: 0, h: 0, dpr: 1 };
    this.children = [];

    // Paused for two independent reasons; render only when neither holds.
    this.hidden = document.visibilityState === 'hidden';
    this.offscreen = false;
    this.disposed = false;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,      // one axis-aligned quad; nothing to alias
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false,
    });
    this.renderer.setClearColor(0x0a0a0b, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this.camera.position.z = 1;

    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);

    this.resize();

    window.addEventListener('resize', this._onResize, { passive: true });
    window.addEventListener('orientationchange', this._onResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);

    // Stop drawing entirely when the canvas is scrolled out of view.
    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver(
        ([entry]) => { this.offscreen = !entry.isIntersecting; },
        { threshold: 0 }
      );
      this.io.observe(canvas);
    }
  }

  add(object) {
    this.children.push(object);
    if (object.mesh) this.scene.add(object.mesh);
    if (object.resize) object.resize(this.size);
    return object;
  }

  get running() { return !this.disposed && !this.hidden && !this.offscreen; }

  _onVisibility() {
    this.hidden = document.visibilityState === 'hidden';
  }

  _onResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this.resize(), RESIZE_DEBOUNCE);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.size = { w, h, dpr };

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);

    // Frustum is aspect-independent by design: the plane, not the camera,
    // carries the aspect correction.
    this.camera.left = -1;
    this.camera.right = 1;
    this.camera.top = 1;
    this.camera.bottom = -1;
    this.camera.updateProjectionMatrix();

    for (const child of this.children) {
      if (child.resize) child.resize(this.size);
    }

    // A resize while paused would otherwise leave a stale, wrongly-sized frame.
    this.renderer.render(this.scene, this.camera);
  }

  /** Called from the GSAP ticker so the whole page shares one clock. */
  render(time, delta) {
    if (!this.running) return;
    for (const child of this.children) {
      if (child.update) child.update(time, delta);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Force exactly one frame regardless of pause state (preloader hand-off). */
  renderOnce(time = 0, delta = 0) {
    if (this.disposed) return;
    for (const child of this.children) {
      if (child.update) child.update(time, delta);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this._resizeTimer);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.io) this.io.disconnect();

    for (const child of this.children) {
      if (child.dispose) child.dispose();
      if (child.mesh) this.scene.remove(child.mesh);
    }
    this.children.length = 0;

    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
