import * as THREE from 'three';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../config/theme';

const MOTION_TRAIL_VERTEX_SHADER = /* glsl */ `
const float PI = 3.14159265359;

uniform float uTurnProgress;
uniform float uVelocity;
uniform float uCurlStrength;
uniform float uTime;
uniform float uTrailSpan;
uniform float uPageWidth;
uniform float uPageHeight;

varying vec2 vUv;
varying float vTrailFactor;

void main() {
  vUv = uv;

  // uv.x runs along radial distance from spine (0) to outer page edge (1)
  // uv.y runs from bottom (+Z) to top (-Z)
  float u = uv.x;
  float zNorm = (0.5 - uv.y) * 2.0;
  float zBase = zNorm * (uPageHeight * 0.49);

  // Trail stretches smoothly behind the turning leaf according to uVelocity
  float trailStretch = uTrailSpan * (0.35 + 0.65 * uVelocity);
  float p = clamp(uTurnProgress - (1.0 - u) * trailStretch * 0.42, 0.0, 1.0);
  float env = sin(p * PI);

  float lag = (0.32 + 0.28 * uVelocity) * uCurlStrength;
  float pBent = clamp(p * (1.0 + lag) - lag * pow(u, 1.2), 0.0, 1.0);
  float angle = pBent * PI;

  float c = cos(angle);
  float s = sin(angle);

  float xPos = u * uPageWidth * c + s * sin(u * PI) * 0.28 * cos(p * PI);
  float restArch = 0.052 * sin(pow(u, 0.72) * PI * 0.90);
  float archShape = (0.86 * sin(u * PI * 0.76) + 0.20 * u) * s;
  float peakScale = 1.18 + 0.24 * uCurlStrength + 0.16 * uVelocity;
  float yPos = max(restArch + archShape * peakScale + 0.03 * env, restArch + 0.02);

  // Subtle ribbon flutter
  float flutter = sin(u * 10.0 - uTime * 24.0 + zNorm * 2.2) * 0.05 * pow(u, 1.4) * env * uVelocity;
  yPos += flutter;

  vTrailFactor = env * smoothstep(0.08, 0.75, u);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(xPos, yPos, zBase, 1.0);
}
`;

const MOTION_TRAIL_FRAGMENT_SHADER = /* glsl */ `
uniform float uVelocity;
uniform float uTurnProgress;
uniform float uTime;
uniform vec3 uGoldColor;
uniform vec3 uSepiaColor;

varying vec2 vUv;
varying float vTrailFactor;

void main() {
  // Cleanly invisible when velocity is low
  float velAlpha = smoothstep(0.05, 0.38, uVelocity);
  if (velAlpha <= 0.001) discard;

  // Soft edges along top/bottom (vUv.y) and inner spine / outer tip (vUv.x)
  float edgeV = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
  float edgeU = smoothstep(0.06, 0.45, vUv.x) * smoothstep(1.0, 0.72, vUv.x);

  // Fine horizontal newsprint-smear streak lines echoing blurred columns of type
  float streakA = 0.55 + 0.45 * sin(vUv.y * 54.0 + uTime * 3.0);
  float streakB = 0.65 + 0.35 * sin(vUv.y * 128.0 - uTurnProgress * 18.0);
  float streaks = mix(0.6, streakA * streakB, 0.55);

  // Warm sepia near inner body, luminous golden highlight along outer sweeping crest
  vec3 tint = mix(uSepiaColor, uGoldColor, smoothstep(0.25, 0.92, vUv.x));

  float alpha = velAlpha * vTrailFactor * edgeV * edgeU * streaks * (0.20 + 0.14 * uVelocity);

  gl_FragColor = vec4(tint, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface MotionTrailMaterialOptions {
  pageWidth?: number;
  pageHeight?: number;
  curlStrength?: number;
  trailSpan?: number;
}

/**
 * Creates an alpha-blended velocity-coupled motion-blur ghost ribbon material
 * that trails behind fast-turning pages during the 8-second sweep and fades
 * cleanly to zero when `uVelocity < 0.05`.
 */
export function createMotionTrailMaterial(
  options: MotionTrailMaterialOptions = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTurnProgress: { value: 0.0 },
      uVelocity: { value: 0.0 },
      uCurlStrength: { value: options.curlStrength ?? 1.0 },
      uTime: { value: 0.0 },
      uTrailSpan: { value: options.trailSpan ?? 0.24 },
      uPageWidth: { value: options.pageWidth ?? PAGE_WIDTH },
      uPageHeight: { value: options.pageHeight ?? PAGE_HEIGHT },
      uGoldColor: { value: new THREE.Color(0xf6d394) },
      uSepiaColor: { value: new THREE.Color(0xcba978) },
    },
    vertexShader: MOTION_TRAIL_VERTEX_SHADER,
    fragmentShader: MOTION_TRAIL_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
}
