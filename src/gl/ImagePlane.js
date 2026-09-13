import * as THREE from 'three';
import vertexShader from './shaders/video.vert?raw';
import fragmentShader from './shaders/image.frag?raw';

const damp = (current, target, lambda, delta) =>
  current + (target - current) * (1 - Math.exp(-lambda * delta));

/**
 * DORMANT. The booth is currently presented as two plain <img> options in
 * section V so its treatment can be chosen; nothing imports this yet. Kept
 * because the twinkle/bloom shader in image.frag is the natural thing to put
 * back on whichever option wins.
 *
 * The ring-toss drawing, drawn into a box measured off a DOM element.
 *
 * Unlike the film's plane this one has no scroll choreography to tween its
 * box: its section is not pinned, so it simply follows its element every
 * frame. That is one getBoundingClientRect on one element, and it means the
 * GL and the layout cannot disagree at any scroll position or viewport.
 */
export default class ImagePlane {
  constructor({ src, mobile = false }) {
    this.src = src;
    this.mobile = mobile;
    this.viewport = { w: 0, h: 0, dpr: 1 };
    this.box = { x: 0, y: 0, w: 1, h: 1 };
    this.target = null;
    this._opacity = 0;

    this.uniforms = {
      uTexture:    { value: null },
      uPlaneSize:  { value: new THREE.Vector2(1, 1) },
      uTexSize:    { value: new THREE.Vector2(1600, 874) },

      uTime:       { value: 0 },
      uZoom:       { value: 1.0 },
      uFit:        { value: 1.0 },
      uContrast:   { value: 1.22 },
      uExposure:   { value: 1.0 },
      uPivot:      { value: 0.13 },
      uInvert:     { value: 1.0 },
      uTwinkle:    { value: mobile ? 1.5 : 2.2 },
      uGlow:       { value: mobile ? 0.35 : 0.55 },
      uGrain:      { value: mobile ? 0.035 : 0.055 },
      uVignette:   { value: 0.42 },
      uAberration: { value: 0.9 },
      uOpacity:    { value: 0 },
      uMatte:      { value: 1.6 },
      uBackdrop:   { value: 0.55 },
      uReveal:     { value: 0 },
    };

    const defines = {};
    if (mobile) defines.MOBILE = '';

    this.geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      defines,
      /* The booth composites over the film rather than cutting a hole in it.
         Premultiplied alpha means the shader emits light directly and the
         alpha only controls how much of the film it hides, so bright strokes
         read solid while blank paper disappears entirely. */
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;      // over the film
    this.mesh.visible = false;      // nothing to draw until it is on screen
  }

  load() {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        this.src,
        (tex) => {
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.generateMipmaps = false;
          this.texture = tex;
          this.uniforms.uTexture.value = tex;
          this.uniforms.uTexSize.value.set(tex.image.width, tex.image.height);
          resolve(tex);
        },
        undefined,
        () => reject(new Error(`Could not load ${this.src}`))
      );
    });
  }

  /** The DOM element this plane occupies. */
  follow(element) { this.target = element; }

  /** 0..1, tweened by the section's ScrollTrigger. */
  set opacity(v) { this._opacity = v; }
  get opacity() { return this._opacity; }

  resize(size) { this.viewport = size; }

  _applyBox(x, y, w, h) {
    const vp = this.viewport;
    if (!vp.w || !vp.h) return;
    this.box = { x, y, w, h };

    this.mesh.scale.set(w / vp.w, h / vp.h, 1);
    this.mesh.position.x = ((x + w / 2) / vp.w) * 2 - 1;
    this.mesh.position.y = 1 - ((y + h / 2) / vp.h) * 2;

    this.uniforms.uPlaneSize.value.set(w, h);

    // same cover-to-contain easing as the film, for the same reason
    const tex = this.uniforms.uTexSize.value;
    const contain = Math.min(1, (w / Math.max(h, 1)) / (tex.x / Math.max(tex.y, 1)));
    const severity = 1 - contain;
    const t = THREE.MathUtils.smoothstep(severity, 0.5, 0.72);
    this.uniforms.uFit.value = 1 - t * 0.85 * severity;
  }

  update(time, delta) {
    const u = this.uniforms;
    u.uTime.value = time;

    u.uOpacity.value = damp(u.uOpacity.value, this._opacity, 6.0, Math.min(delta, 0.1));

    // Nothing is drawn while it is invisible, so the extra taps in this
    // shader are only ever paid for while the section is actually on screen.
    const visible = u.uOpacity.value > 0.002 && !!this.texture;
    this.mesh.visible = visible;
    if (!visible || !this.target) return;

    const r = this.target.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { this.mesh.visible = false; return; }
    this._applyBox(r.left, r.top, r.width, r.height);
  }

  dispose() {
    this.texture?.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
