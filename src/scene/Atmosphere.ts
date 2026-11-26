import * as THREE from 'three';
import type { TimelineState } from '../types';

const BACKDROP_VERTEX_SHADER = /* glsl */ `
varying vec3 vLocalDir;

void main() {
  vLocalDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BACKDROP_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uNadirColor;
uniform vec3 uGoldGlowColor;
uniform vec3 uKeyDir;

varying vec3 vLocalDir;

void main() {
  vec3 dir = normalize(vLocalDir);
  float h = dir.y;

  // Deep midnight slate-blue studio gradient with natural blue horizon & subtle warm golden beam glow
  vec3 baseGrad = h >= 0.0
    ? mix(uHorizonColor, uZenithColor, pow(clamp(h, 0.0, 1.0), 0.72))
    : mix(uHorizonColor, uNadirColor, pow(clamp(-h, 0.0, 1.0), 0.65));

  float sunAlign = max(dot(dir, normalize(uKeyDir)), 0.0);
  vec3 goldBloom = uGoldGlowColor * pow(sunAlign, 3.2) * 0.42;

  gl_FragColor = vec4(baseGrad + goldBloom, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const DUST_VERTEX_SHADER = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;

uniform float uTime;
uniform float uPixelRatio;
uniform float uSweepDrift;

varying float vAlpha;
varying vec3 vColor;

void main() {
  vec3 pos = position;

  // Peaceful gentle drift + subtle horizontal breeze stirred by fast-turning pages
  pos.x = mod(pos.x - uSweepDrift + 10.5, 21.0) - 10.5;
  pos.y += sin(uTime * 0.42 + aPhase) * 0.24;
  pos.z += cos(uTime * 0.35 + aPhase * 1.3) * 0.18;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float twinkle = 0.55 + 0.45 * sin(uTime * 1.35 + aPhase * 3.1);
  // Soft radial fade near outer perimeter
  float edgeFade = 1.0 - smoothstep(7.2, 10.4, length(pos.xz));
  vAlpha = twinkle * edgeFade * 0.68;
  vColor = aColor;

  gl_PointSize = aSize * uPixelRatio * (18.0 / max(-mvPosition.z, 1.0));
}
`;

const DUST_FRAGMENT_SHADER = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float dist = length(c);
  if (dist > 0.5) discard;

  // Soft luminous radial glow
  float glow = pow(1.0 - dist * 2.0, 2.2);
  gl_FragColor = vec4(vColor, glow * vAlpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Adds atmospheric golden dust motes drifting through the warm sunbeam above
 * and cool natural-blue motes below the cardboard table, plus a subtle
 * golden-blue studio gradient backdrop dome.
 */
export class Atmosphere {
  public readonly group: THREE.Group;

  private readonly domeGeo: THREE.SphereGeometry;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly dustGeo: THREE.BufferGeometry;
  private readonly dustMat: THREE.ShaderMaterial;

  private sweepDrift = 0;
  private lastTime = -1;

  constructor(moteCount = 220) {
    this.group = new THREE.Group();
    this.group.name = 'Atmosphere';

    // 1. Warm Golden + Soft Twilight-Blue Atmospheric Backdrop Gradient Dome
    this.domeGeo = new THREE.SphereGeometry(52, 32, 20);
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenithColor: { value: new THREE.Color(0x111624) },
        uHorizonColor: { value: new THREE.Color(0x282632) },
        uNadirColor: { value: new THREE.Color(0x12131c) },
        uGoldGlowColor: { value: new THREE.Color(0xe39642) },
        uKeyDir: { value: new THREE.Vector3(6.8, 10.6, 5.4).normalize() },
      },
      vertexShader: BACKDROP_VERTEX_SHADER,
      fragmentShader: BACKDROP_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const domeMesh = new THREE.Mesh(this.domeGeo, this.domeMat);
    domeMesh.renderOrder = -10;
    this.group.add(domeMesh);

    // 2. Floating Warm Golden & Soft Twilight-Blue Dust Motes
    const rng = createSeededRng(19891109);
    const positions = new Float32Array(moteCount * 3);
    const sizes = new Float32Array(moteCount);
    const phases = new Float32Array(moteCount);
    const colors = new Float32Array(moteCount * 3);

    const warmGold = new THREE.Color(0xffd788);
    const softAmber = new THREE.Color(0xf7b254);
    const coolBlue = new THREE.Color(0x9ac3f0);
    const tempColor = new THREE.Color();

    for (let i = 0; i < moteCount; i++) {
      const isUnder = i >= Math.floor(moteCount * 0.78);
      const x = (rng() - 0.5) * 19.5;
      const y = isUnder ? -(0.45 + rng() * 3.0) : 0.25 + rng() * 6.4;
      const z = (rng() - 0.5) * 15.5;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      sizes[i] = isUnder ? 2.4 + rng() * 3.0 : 2.2 + rng() * 4.2;
      phases[i] = rng() * Math.PI * 2;

      if (isUnder) {
        tempColor.copy(coolBlue).lerp(warmGold, 0.35 + rng() * 0.35);
      } else {
        tempColor.copy(warmGold).lerp(softAmber, rng() * 0.72);
      }
      colors[i * 3] = tempColor.r;
      colors[i * 3 + 1] = tempColor.g;
      colors[i * 3 + 2] = tempColor.b;
    }

    this.dustGeo = new THREE.BufferGeometry();
    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.dustGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.dustGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uSweepDrift: { value: 0 },
      },
      vertexShader: DUST_VERTEX_SHADER,
      fragmentShader: DUST_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(this.dustGeo, this.dustMat);
    points.frustumCulled = false;
    points.renderOrder = 15;
    this.group.add(points);
  }

  public update(elapsedTime: number, timeline?: TimelineState): void {
    const dt =
      this.lastTime < 0
        ? 0
        : Math.min(0.1, Math.max(0, elapsedTime - this.lastTime));
    this.lastTime = elapsedTime;

    const sweepBoost = timeline ? timeline.sweepVelocity * 1.45 : 0;
    this.sweepDrift += dt * (0.14 + sweepBoost);

    this.dustMat.uniforms.uTime.value = elapsedTime;
    this.dustMat.uniforms.uSweepDrift.value = this.sweepDrift;
  }

  public resize(): void {
    this.dustMat.uniforms.uPixelRatio.value = Math.min(
      window.devicePixelRatio || 1,
      2,
    );
  }

  public dispose(): void {
    this.domeGeo.dispose();
    this.domeMat.dispose();
    this.dustGeo.dispose();
    this.dustMat.dispose();
  }
}
