import * as THREE from 'three';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../config/theme';

/**
 * Shared golden-key + cool natural-blue fill lighting parameters used by both
 * `SceneManager` and our custom GLSL page shaders so PBR surfaces (cardboard table)
 * and custom shader surfaces (turning leaves + open broadsheet) match seamlessly.
 */
export const CINEMATIC_LIGHTING = {
  backgroundHex: 0x13161f,
  fogHex: 0x171a24,
  fogDensity: 0.016,
  // Rich warm golden-amber directional key light (upper-right / front)
  keyColorHex: 0xffad52,
  keyIntensity: 3.35,
  keyPosition: new THREE.Vector3(6.8, 10.6, 5.4),
  // Soft warm-tinted twilight sky + warm amber-sienna ground bounce
  hemiSkyHex: 0x82a7d4,
  hemiGroundHex: 0x5c3d20,
  hemiIntensity: 1.32,
  // Gentle natural-blue rim/fill directional light (opposite upper-left / back)
  fillColorHex: 0x7aa4d9,
  fillIntensity: 0.94,
  fillPosition: new THREE.Vector3(-7.4, 6.2, -5.6),
  // Lush warm honey-gold overhead spotlight pool over the floating broadsheet
  spotColorHex: 0xffc06b,
  spotIntensity: 29.0,
  spotPosition: new THREE.Vector3(0.4, 9.5, 1.2),
  // Warm amber under-spread glow + subtle natural-blue deep rim illuminating floating texts below
  underLightHex: 0xe69848,
  underLightIntensity: 14.5,
  underLightPosition: new THREE.Vector3(0.0, -1.8, 0.8),
  underFrontLightHex: 0x6ea0db,
  underFrontLightIntensity: 7.5,
  underFrontLightPosition: new THREE.Vector3(0.0, -1.6, 5.4),
  toneMappingExposure: 1.18,
} as const;

function createSharedLightingUniforms() {
  const keyDir = CINEMATIC_LIGHTING.keyPosition.clone().normalize();
  const fillDir = CINEMATIC_LIGHTING.fillPosition.clone().normalize();
  return {
    uKeyLightDir: { value: keyDir },
    uKeyLightColor: { value: new THREE.Color(CINEMATIC_LIGHTING.keyColorHex) },
    uFillLightDir: { value: fillDir },
    uFillLightColor: { value: new THREE.Color(CINEMATIC_LIGHTING.fillColorHex) },
    uHemiSkyColor: { value: new THREE.Color(CINEMATIC_LIGHTING.hemiSkyHex) },
    uHemiGroundColor: { value: new THREE.Color(CINEMATIC_LIGHTING.hemiGroundHex) },
  };
}

/**
 * Shared GLSL page deformation math used identically by both the shaded
 * `TurningPageMaterial` and `TurningPageDepthMaterial` so cast shadows match
 * curved turning pages with exact precision.
 */
const PAGE_CURL_COMMON_GLSL = /* glsl */ `
const float PI = 3.14159265359;

uniform float uTurnProgress;
uniform float uCurlStrength;
uniform float uVelocity;
uniform float uTime;
uniform float uDropFlex;
uniform float uCornerLead;
uniform float uRestArchScale;
uniform float uPageWidth;
uniform float uPageHeight;

// Evaluates curved 3D local position for a hinged leaf:
// pageUv.x in [0, 1] (0 = spine at x=0, 1 = outer edge at x=uPageWidth)
// pageUv.y in [0, 1] (1 = top edge -Z, 0 = bottom edge +Z)
vec3 evalTurningPagePos(vec2 pageUv) {
  float u = clamp(pageUv.x, 0.0, 1.0);
  float v = clamp(pageUv.y, 0.0, 1.0);
  float zNorm = (0.5 - v) * 2.0; // -1 at top (-Z), +1 at bottom (+Z)
  float zBase = zNorm * (uPageHeight * 0.5);

  float p = clamp(uTurnProgress, 0.0, 1.0);
  float turnEnv = sin(p * PI);

  // Subtle diagonal corner-lead twist (bottom/top corner leads like fingertips lifting paper)
  // Strictly zero at p=0 and p=1 thanks to turnEnv.
  float cornerOffset = uCornerLead * zNorm * turnEnv * (0.28 + 0.72 * u);
  float pLocal = clamp(p + cornerOffset, 0.0, 1.0);
  float localEnv = sin(pLocal * PI);

  // Organic outer-edge lag due to air resistance and paper flexibility
  float lag = (0.30 + 0.24 * uVelocity) * uCurlStrength;
  float pBent = clamp(pLocal * (1.0 + lag) - lag * pow(u, 1.22), 0.0, 1.0);

  // Subtle lift lead right as the page starts peeling off the right stack
  float liftPeel = sin(pLocal * PI) * (1.0 - pLocal) * 0.14 * uCurlStrength * pow(u, 1.6);
  float angle = clamp(pBent * PI + liftPeel, 0.0, PI);

  float c = cos(angle);
  float s = sin(angle);

  // Exact sculpted resting spread contour so turning leaves NEVER intersect the open spread
  // at uTurnProgress -> 0.0 (lifting off right page) or uTurnProgress -> 1.0 (settling on left page)
  float restArch = 0.052 * sin(pow(u, 0.72) * PI * 0.90);
  float restRipple = 0.004 * sin(zNorm * PI * 1.5 + u * 2.2) * u;
  float restContour = (restArch + restRipple) * uRestArchScale;

  // Parabolic-cylindrical broadsheet arch peaking gracefully ~1.2 - 1.55 units above table
  float xPos = u * uPageWidth * c;
  // Subtle outward horizontal arch bow to preserve natural broadsheet fullness
  xPos += s * sin(u * PI) * 0.30 * uCurlStrength * cos(pLocal * PI);

  float archShape = (0.86 * sin(u * PI * 0.76) + 0.20 * u) * s;
  float peakScale = 1.16 + 0.24 * uCurlStrength + 0.14 * uVelocity;
  float yPos = restContour + archShape * peakScale;

  // Aerodynamic flutter waves traveling along outer edge proportional to sweep velocity
  float flutterMask = pow(u, 1.55) * localEnv * uVelocity;
  float wave1 = sin(u * 9.5 - uTime * 21.0 + zNorm * 2.5);
  float wave2 = cos(u * 15.5 - uTime * 30.0 - zNorm * 3.6) * 0.42;
  float flutter = (wave1 + wave2) * 0.085 * flutterMask;
  yPos += flutter * (0.45 + 0.55 * abs(c));
  xPos -= flutter * 0.45 * s;

  // Subtle conical Z pull-in when bent diagonally so paper feels taut
  float zPos = zBase * (1.0 - 0.018 * u * localEnv * uCurlStrength);

  // Organic aerodynamic billowing & drape while flying through open space before opening
  float flyBillow = sin(u * PI) * 0.34 + 0.16 * u * (1.0 - 0.42 * zNorm * zNorm);
  float flyWave = 0.075 * sin(u * 4.5 - uTime * 5.2 + zNorm * 1.4) * u;
  float dropArch = uDropFlex * (flyBillow + flyWave) * (1.0 - turnEnv);
  yPos += dropArch;

  // Floor guarantee keeps flexed/fluttered edges strictly above the sculpted resting contour
  yPos = max(yPos, restContour);

  return vec3(xPos, yPos, zPos);
}
`;

const TURNING_PAGE_VERTEX_SHADER = /* glsl */ `
${PAGE_CURL_COMMON_GLSL}

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vArchHeight;

void main() {
  vUv = uv;

  vec3 pos = evalTurningPagePos(uv);
  vArchHeight = pos.y;

  // Accurate finite-difference bent surface normal in local space
  float eps = 0.005;
  vec3 posUPlus  = evalTurningPagePos(vec2(min(1.0, uv.x + eps), uv.y));
  vec3 posUMinus = evalTurningPagePos(vec2(max(0.0, uv.x - eps), uv.y));
  vec3 posVPlus  = evalTurningPagePos(vec2(uv.x, min(1.0, uv.y + eps)));
  vec3 posVMinus = evalTurningPagePos(vec2(uv.x, max(0.0, uv.y - eps)));

  // Increasing uv.x moves +X (at p=0); increasing uv.y moves -Z.
  // Right-handed cross(+X, -Z) = +Y (upward normal on front face).
  vec3 tangentU = posUPlus - posUMinus;
  vec3 tangentV = posVPlus - posVMinus;
  vec3 bentNormal = normalize(cross(tangentU, tangentV));

  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * bentNormal);

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const TURNING_PAGE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uFrontMap;
uniform sampler2D uBackMap;
uniform sampler2D uBumpMap;
uniform float uHasBumpMap;
uniform float uTurnProgress;
uniform float uVelocity;
uniform float uOpacity;

uniform vec3 uKeyLightDir;
uniform vec3 uKeyLightColor;
uniform vec3 uFillLightDir;
uniform vec3 uFillLightColor;
uniform vec3 uHemiSkyColor;
uniform vec3 uHemiGroundColor;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vArchHeight;

vec3 samplePaperMotionBlur(sampler2D tex, vec2 uv, float blurRadius) {
  if (blurRadius < 0.0008) {
    return texture2D(tex, uv).rgb;
  }
  vec3 c0 = texture2D(tex, vec2(clamp(uv.x - blurRadius * 1.5, 0.002, 0.998), uv.y)).rgb * 0.12;
  vec3 c1 = texture2D(tex, vec2(clamp(uv.x - blurRadius * 0.7, 0.002, 0.998), uv.y)).rgb * 0.22;
  vec3 c2 = texture2D(tex, uv).rgb * 0.32;
  vec3 c3 = texture2D(tex, vec2(clamp(uv.x + blurRadius * 0.7, 0.002, 0.998), uv.y)).rgb * 0.22;
  vec3 c4 = texture2D(tex, vec2(clamp(uv.x + blurRadius * 1.5, 0.002, 0.998), uv.y)).rgb * 0.12;
  return c0 + c1 + c2 + c3 + c4;
}

void main() {
  // Horizontally mirror U on back face so flipped print reads left-to-right naturally
  vec2 sampleUv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);

  // Motion-blur scales naturally with sweep velocity, mid-turn envelope, and distance from spine
  float turnEnv = sin(clamp(uTurnProgress, 0.0, 1.0) * 3.14159265359);
  float motionBlur = uVelocity * turnEnv * (0.20 + 0.80 * vUv.x) * 0.026;

  vec3 albedo = gl_FrontFacing
    ? samplePaperMotionBlur(uFrontMap, sampleUv, motionBlur)
    : samplePaperMotionBlur(uBackMap, sampleUv, motionBlur);

  vec3 N = normalize(gl_FrontFacing ? vWorldNormal : -vWorldNormal);

  // Subtle fibrous newsprint micro-bump perturbation
  if (uHasBumpMap > 0.5) {
    float bC = texture2D(uBumpMap, sampleUv).r;
    float bX = texture2D(uBumpMap, sampleUv + vec2(0.002, 0.0)).r;
    float bY = texture2D(uBumpMap, sampleUv + vec2(0.0, 0.002)).r;
    vec3 bumpPerturb = vec3((bC - bX) * 0.22, 0.0, (bY - bC) * 0.22);
    N = normalize(N + bumpPerturb);
  }

  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 Lkey = normalize(uKeyLightDir);
  vec3 Lfill = normalize(uFillLightDir);

  // Warm golden key directional light with soft paper wrap
  float NdotL = dot(N, Lkey);
  float keyDiff = max((NdotL + 0.14) / 1.14, 0.0);

  // Gentle fibrous matte-paper sheen on curved arch highlight
  vec3 Hkey = normalize(Lkey + V);
  float keySpec = pow(max(dot(N, Hkey), 0.0), 18.0) * 0.11;

  // Subtle warm backlit translucency through lifted aged newsprint
  float backLight = pow(max(dot(-N, Lkey), 0.0), 1.5) * turnEnv * 0.24;

  // Gentle natural-blue rim/fill directional light
  float fillDiff = max(dot(N, Lfill), 0.0);
  vec3 Hfill = normalize(Lfill + V);
  float fillRim = pow(max(dot(N, Hfill), 0.0), 10.0) * 0.09;

  // Warm-balanced twilight hemisphere
  float hemiFactor = N.y * 0.5 + 0.5;
  vec3 hemiLight = mix(uHemiGroundColor, uHemiSkyColor, hemiFactor) * 0.54;

  // Warm golden overhead spotlight pool centered over the spread
  float spotDist = length(vWorldPos.xz - vec2(0.15, 0.2));
  float spotPool = 1.0 - smoothstep(2.4, 9.2, spotDist);
  vec3 spotBoost = vec3(1.0, 0.78, 0.44) * (0.32 * spotPool * max(N.y, 0.18));

  // Spine crease ambient occlusion near spine (vUv.x -> 0)
  float spineAO = mix(0.68, 1.0, smoothstep(0.0, 0.10, vUv.x));
  // Arch elevation lifts the leaf into brighter golden light
  float archLiftLight = 1.0 + clamp(vArchHeight * 0.06, 0.0, 0.12);

  vec3 lighting =
    uKeyLightColor * (keyDiff * 1.02 + backLight) +
    uFillLightColor * (fillDiff * 0.34) +
    hemiLight +
    spotBoost;

  vec3 specContrib = uKeyLightColor * keySpec + uFillLightColor * fillRim;
  vec3 finalColor = (albedo * lighting * archLiftLight + specContrib) * spineAO;

  gl_FragColor = vec4(finalColor, uOpacity);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const TURNING_PAGE_DEPTH_VERTEX_SHADER = /* glsl */ `
${PAGE_CURL_COMMON_GLSL}

varying vec2 vHighPrecisionZW;

void main() {
  vec3 pos = evalTurningPagePos(uv);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  vHighPrecisionZW = gl_Position.zw;
}
`;

const TURNING_PAGE_DEPTH_FRAGMENT_SHADER = /* glsl */ `
#include <packing>

varying vec2 vHighPrecisionZW;

void main() {
  float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
  gl_FragColor = packDepthToRGBA(fragCoordZ);
}
`;

export interface TurningPageMaterialOptions {
  frontMap: THREE.Texture;
  backMap: THREE.Texture;
  bumpMap?: THREE.Texture | null;
  curlStrength?: number;
  cornerLead?: number;
  restArchScale?: number;
  pageWidth?: number;
  pageHeight?: number;
}

export interface TurningPageUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uFrontMap: THREE.IUniform<THREE.Texture>;
  uBackMap: THREE.IUniform<THREE.Texture>;
  uBumpMap: THREE.IUniform<THREE.Texture | null>;
  uHasBumpMap: THREE.IUniform<number>;
  uTurnProgress: THREE.IUniform<number>;
  uCurlStrength: THREE.IUniform<number>;
  uVelocity: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uDropFlex: THREE.IUniform<number>;
  uCornerLead: THREE.IUniform<number>;
  uRestArchScale: THREE.IUniform<number>;
  uPageWidth: THREE.IUniform<number>;
  uPageHeight: THREE.IUniform<number>;
  uOpacity: THREE.IUniform<number>;
  uKeyLightDir: THREE.IUniform<THREE.Vector3>;
  uKeyLightColor: THREE.IUniform<THREE.Color>;
  uFillLightDir: THREE.IUniform<THREE.Vector3>;
  uFillLightColor: THREE.IUniform<THREE.Color>;
  uHemiSkyColor: THREE.IUniform<THREE.Color>;
  uHemiGroundColor: THREE.IUniform<THREE.Color>;
}

/**
 * Creates a double-sided GLSL ShaderMaterial with realistic 3D parabolic/cylindrical
 * page bending, diagonal corner-lead twist, aerodynamic flutter, golden+blue shading,
 * and velocity-coupled 5-tap motion blur.
 */
export function createTurningPageMaterial(
  options: TurningPageMaterialOptions,
): THREE.ShaderMaterial {
  const uniforms: TurningPageUniforms = {
    uFrontMap: { value: options.frontMap },
    uBackMap: { value: options.backMap },
    uBumpMap: { value: options.bumpMap ?? null },
    uHasBumpMap: { value: options.bumpMap ? 1.0 : 0.0 },
    uTurnProgress: { value: 0.0 },
    uCurlStrength: { value: options.curlStrength ?? 1.0 },
    uVelocity: { value: 0.0 },
    uTime: { value: 0.0 },
    uDropFlex: { value: 0.0 },
    uCornerLead: { value: options.cornerLead ?? 0.075 },
    uRestArchScale: { value: options.restArchScale ?? 1.0 },
    uPageWidth: { value: options.pageWidth ?? PAGE_WIDTH },
    uPageHeight: { value: options.pageHeight ?? PAGE_HEIGHT },
    uOpacity: { value: 1.0 },
    ...createSharedLightingUniforms(),
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TURNING_PAGE_VERTEX_SHADER,
    fragmentShader: TURNING_PAGE_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: false,
  });
}

/**
 * Creates a matching custom depth material for `mesh.customDepthMaterial` that
 * shares the exact vertex curl uniform objects from `sourceMaterial` so turning
 * pages cast accurate curved moving shadows onto the spread and cardboard table.
 */
export function createTurningPageDepthMaterial(
  sourceMaterial: THREE.ShaderMaterial,
): THREE.ShaderMaterial {
  const src = sourceMaterial.uniforms;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTurnProgress: src.uTurnProgress,
      uCurlStrength: src.uCurlStrength,
      uVelocity: src.uVelocity,
      uTime: src.uTime,
      uDropFlex: src.uDropFlex,
      uCornerLead: src.uCornerLead,
      uRestArchScale: src.uRestArchScale,
      uPageWidth: src.uPageWidth,
      uPageHeight: src.uPageHeight,
    },
    vertexShader: TURNING_PAGE_DEPTH_VERTEX_SHADER,
    fragmentShader: TURNING_PAGE_DEPTH_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });
}

// ============================================================================
// Final Spread Reveal & Overview-Veil Material
// ============================================================================

const SPREAD_PAGE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const SPREAD_PAGE_FRAGMENT_SHADER = /* glsl */ `
const float PI = 3.14159265359;

uniform sampler2D uBasePaperMap;
uniform sampler2D uPrintMap;
uniform sampler2D uBodyMaskMap;
uniform sampler2D uBumpMap;
uniform float uHasBumpMap;

uniform float uMastheadReveal;
uniform float uMastheadCutV;
uniform float uSectionReveals[3];
uniform vec4 uSectionRects[3];
uniform float uReadability;
uniform vec4 uActiveRect;
uniform float uHasAnyActiveSection;
uniform float uPageSide; // -1.0 = left page, +1.0 = right page
uniform vec3 uSweepShadow; // x = shadow world X center, y = opacity 0..1, z = width
uniform float uTime;

uniform vec3 uKeyLightDir;
uniform vec3 uKeyLightColor;
uniform vec3 uFillLightDir;
uniform vec3 uFillLightColor;
uniform vec3 uHemiSkyColor;
uniform vec3 uHemiGroundColor;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float paperGrainFbm(vec2 p) {
  float v = 0.0;
  v += 0.55 * valueNoise(p);
  v += 0.30 * valueNoise(p * 2.13 + vec2(7.1, 3.4));
  v += 0.15 * valueNoise(p * 4.57 + vec2(2.3, 9.8));
  return v;
}

// Computes organic ink-soak reveal factor + frontier bloom for a progress value r in [0,1]
vec2 evalInkWave(float r, float flowCoord, float grain) {
  if (r <= 0.001) return vec2(0.0, 0.0);
  if (r >= 0.999) return vec2(1.0, 0.0);

  float frontier = r * 1.28 - 0.14;
  float warpedCoord = flowCoord + (grain - 0.5) * 0.22;
  float reveal = smoothstep(warpedCoord - 0.09, warpedCoord + 0.07, frontier);

  // Soft ink-soak darkening bloom right along the moving reveal edge
  float edgeBand = smoothstep(0.02, 0.48, reveal) * smoothstep(0.98, 0.52, reveal);
  float edgeBloom = edgeBand * sin(r * PI);
  return vec2(reveal, edgeBloom);
}

void main() {
  // Convert WebGL UV (vUv.y = 1 at top) into document UV (docUv.y = 0 at top, 1 at bottom)
  // matching NormalizedRect { u, v, w, h } and uMastheadCutV exactly.
  vec2 docUv = vec2(vUv.x, 1.0 - vUv.y);

  vec3 basePaper = texture2D(uBasePaperMap, vUv).rgb;
  vec3 sharpPrint = texture2D(uPrintMap, vUv).rgb;
  float bodyMask = texture2D(uBodyMaskMap, vUv).r;

  // --- 1. Magic Sequential Ink Reveal ---
  float grain = paperGrainFbm(docUv * 24.0 + vec2(uPageSide * 3.7, 1.2));
  vec2 revealState = vec2(0.0, 0.0);

  // Masthead / top banner band
  if (docUv.y < uMastheadCutV) {
    float mhV = docUv.y / max(uMastheadCutV, 0.001);
    float mhFlow = docUv.x * 0.72 + mhV * 0.28;
    revealState = evalInkWave(uMastheadReveal, mhFlow, grain);
  } else {
    bool matchedSection = false;
    for (int i = 0; i < 3; i++) {
      vec4 rect = uSectionRects[i];
      if (rect.z <= 0.0001 || rect.w <= 0.0001) continue;

      // Slight padding (0.012) so section rules & hairline borders reveal cleanly with their block
      float pad = 0.012;
      if (
        docUv.x >= rect.x - pad &&
        docUv.x <= rect.x + rect.z + pad &&
        docUv.y >= rect.y - pad &&
        docUv.y <= rect.y + rect.w + pad
      ) {
        vec2 local = clamp((docUv - rect.xy) / rect.zw, 0.0, 1.0);
        float secFlow = local.y * 0.66 + local.x * 0.34;
        vec2 secState = evalInkWave(uSectionReveals[i], secFlow, grain);
        if (secState.x >= revealState.x) {
          revealState = secState;
        }
        matchedSection = true;
      }
    }

    // Outer margins / page rules / footer folio reveal smoothly alongside masthead & sections
    if (!matchedSection) {
      float anyReveal = max(
        uMastheadReveal,
        max(uSectionReveals[0], max(uSectionReveals[1], uSectionReveals[2]))
      );
      float marginFlow = docUv.y * 0.6 + docUv.x * 0.4;
      revealState = evalInkWave(anyReveal, marginFlow, grain);
    }
  }

  float revealMask = revealState.x;
  float frontierBloom = revealState.y;

  // --- 2. Intentional Overview Subtlety ("zoom in to read/present") ---
  // At uReadability = 0.0 (overview), body text (bodyMask > 0.35) softens & blends ~68%
  // back toward the aged paper tone while headlines, masthead, rules & halftones stay razor-sharp.
  float overviewFactor = 1.0 - smoothstep(0.0, 1.0, uReadability);
  float bodyWeight = smoothstep(0.28, 0.52, bodyMask);
  float veilAmount = overviewFactor * bodyWeight;

  vec3 printColor = sharpPrint;
  if (veilAmount > 0.005) {
    // Subtle 5-tap micro-softening on dense body paragraphs from far away
    vec2 blurOff = vec2(0.0020, 0.0015) * veilAmount;
    vec3 softPrint =
      sharpPrint * 0.28 +
      texture2D(uPrintMap, vUv + vec2(blurOff.x, 0.0)).rgb * 0.18 +
      texture2D(uPrintMap, vUv - vec2(blurOff.x, 0.0)).rgb * 0.18 +
      texture2D(uPrintMap, vUv + vec2(0.0, blurOff.y)).rgb * 0.18 +
      texture2D(uPrintMap, vUv - vec2(0.0, blurOff.y)).rgb * 0.18;

    // Blend ~68% toward aged paper tone for authentic atmospheric overview readability veil
    printColor = mix(sharpPrint, mix(softPrint, basePaper, 0.68), veilAmount);
  }

  // Combine blank aged newsprint with revealed print + warm ink-soak bloom along reveal edge
  vec3 inkBloomTint = basePaper * vec3(0.76, 0.68, 0.56);
  vec3 albedo = mix(basePaper, printColor, revealMask);
  albedo = mix(albedo, inkBloomTint, frontierBloom * 0.28);

  // --- 3. Subtle Focus Spotlight Vignette when a section is active ---
  float focusDim = 1.0;
  if (uHasAnyActiveSection > 0.5) {
    if (uActiveRect.z > 0.0001 && uActiveRect.w > 0.0001) {
      float pad = 0.015;
      float insideX =
        smoothstep(uActiveRect.x - pad - 0.025, uActiveRect.x - pad, docUv.x) *
        (1.0 - smoothstep(uActiveRect.x + uActiveRect.z + pad, uActiveRect.x + uActiveRect.z + pad + 0.025, docUv.x));
      float insideY =
        smoothstep(uActiveRect.y - pad - 0.025, uActiveRect.y - pad, docUv.y) *
        (1.0 - smoothstep(uActiveRect.y + uActiveRect.w + pad, uActiveRect.y + uActiveRect.w + pad + 0.025, docUv.y));
      float inActive = insideX * insideY;
      focusDim = mix(0.87, 1.0, inActive);
    } else {
      // Focused section lives on the opposite page
      focusDim = 0.87;
    }
  }

  // --- 4. Physical Broadsheet Lighting, Spine Crease AO & Overhead Sweep Shadow ---
  vec3 N = normalize(vWorldNormal);
  if (uHasBumpMap > 0.5) {
    float bC = texture2D(uBumpMap, vUv).r;
    float bX = texture2D(uBumpMap, vUv + vec2(0.0018, 0.0)).r;
    float bY = texture2D(uBumpMap, vUv + vec2(0.0, 0.0018)).r;
    N = normalize(N + vec3((bC - bX) * 0.20, 0.0, (bY - bC) * 0.20));
  }

  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 Lkey = normalize(uKeyLightDir);
  vec3 Lfill = normalize(uFillLightDir);

  float keyDiff = max((dot(N, Lkey) + 0.12) / 1.12, 0.0);
  vec3 Hkey = normalize(Lkey + V);
  float keySpec = pow(max(dot(N, Hkey), 0.0), 22.0) * 0.075;

  float fillDiff = max(dot(N, Lfill), 0.0);
  float hemiFactor = N.y * 0.5 + 0.5;
  vec3 hemiLight = mix(uHemiGroundColor, uHemiSkyColor, hemiFactor) * 0.56;

  // Warm golden overhead spotlight pool
  float spotDist = length(vWorldPos.xz - vec2(0.15, 0.2));
  float spotPool = 1.0 - smoothstep(2.4, 9.4, spotDist);
  vec3 spotBoost = vec3(1.0, 0.78, 0.44) * (0.32 * spotPool);

  // Physical center spine valley AO (right edge of left page, left edge of right page)
  float spineDist = uPageSide < 0.0 ? (1.0 - vUv.x) : vUv.x;
  float spineAO = mix(0.62, 1.0, smoothstep(0.0, 0.088, spineDist));
  float creaseHairline = mix(0.76, 1.0, smoothstep(0.0, 0.011, spineDist));

  // Soft curved shadow cast onto the open spread by passing turning leaves
  float sweepShadowMask = 1.0;
  if (uSweepShadow.y > 0.005) {
    float dx = abs(vWorldPos.x - uSweepShadow.x);
    float band = 1.0 - smoothstep(0.15, max(uSweepShadow.z, 0.5), dx);
    sweepShadowMask = 1.0 - band * uSweepShadow.y * 0.42;
  }

  vec3 lighting =
    uKeyLightColor * (keyDiff * 1.02 * sweepShadowMask) +
    uFillLightColor * (fillDiff * 0.34) +
    hemiLight +
    spotBoost * sweepShadowMask;

  vec3 finalColor = (albedo * lighting + uKeyLightColor * keySpec * sweepShadowMask) * spineAO * creaseHairline * focusDim;

  gl_FragColor = vec4(finalColor, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SpreadPageMaterialOptions {
  basePaperMap: THREE.Texture;
  printMap: THREE.Texture;
  bodyMaskMap: THREE.Texture;
  bumpMap?: THREE.Texture | null;
  pageSide: 'left' | 'right';
  mastheadCutV: number;
  sectionRects: THREE.Vector4[];
}

export interface SpreadPageUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uBasePaperMap: THREE.IUniform<THREE.Texture>;
  uPrintMap: THREE.IUniform<THREE.Texture>;
  uBodyMaskMap: THREE.IUniform<THREE.Texture>;
  uBumpMap: THREE.IUniform<THREE.Texture | null>;
  uHasBumpMap: THREE.IUniform<number>;
  uMastheadReveal: THREE.IUniform<number>;
  uMastheadCutV: THREE.IUniform<number>;
  uSectionReveals: THREE.IUniform<number[]>;
  uSectionRects: THREE.IUniform<THREE.Vector4[]>;
  uReadability: THREE.IUniform<number>;
  uActiveRect: THREE.IUniform<THREE.Vector4>;
  uHasAnyActiveSection: THREE.IUniform<number>;
  uPageSide: THREE.IUniform<number>;
  uSweepShadow: THREE.IUniform<THREE.Vector3>;
  uTime: THREE.IUniform<number>;
  uKeyLightDir: THREE.IUniform<THREE.Vector3>;
  uKeyLightColor: THREE.IUniform<THREE.Color>;
  uFillLightDir: THREE.IUniform<THREE.Vector3>;
  uFillLightColor: THREE.IUniform<THREE.Color>;
  uHemiSkyColor: THREE.IUniform<THREE.Color>;
  uHemiGroundColor: THREE.IUniform<THREE.Color>;
}

/**
 * Creates the GLSL ShaderMaterial for the resting open broadsheet spread
 * featuring sequential organic ink-soak reveal, intentional overview body-text
 * readability veil, and subtle active-section focus vignette.
 */
export function createSpreadPageMaterial(
  options: SpreadPageMaterialOptions,
): THREE.ShaderMaterial {
  const paddedRects: THREE.Vector4[] = [
    options.sectionRects[0]?.clone() ?? new THREE.Vector4(0, 0, 0, 0),
    options.sectionRects[1]?.clone() ?? new THREE.Vector4(0, 0, 0, 0),
    options.sectionRects[2]?.clone() ?? new THREE.Vector4(0, 0, 0, 0),
  ];

  const uniforms: SpreadPageUniforms = {
    uBasePaperMap: { value: options.basePaperMap },
    uPrintMap: { value: options.printMap },
    uBodyMaskMap: { value: options.bodyMaskMap },
    uBumpMap: { value: options.bumpMap ?? null },
    uHasBumpMap: { value: options.bumpMap ? 1.0 : 0.0 },
    uMastheadReveal: { value: 0.0 },
    uMastheadCutV: { value: options.mastheadCutV },
    uSectionReveals: { value: [0.0, 0.0, 0.0] },
    uSectionRects: { value: paddedRects },
    uReadability: { value: 0.0 },
    uActiveRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHasAnyActiveSection: { value: 0.0 },
    uPageSide: { value: options.pageSide === 'left' ? -1.0 : 1.0 },
    uSweepShadow: { value: new THREE.Vector3(0, 0, 2.2) },
    uTime: { value: 0.0 },
    ...createSharedLightingUniforms(),
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SPREAD_PAGE_VERTEX_SHADER,
    fragmentShader: SPREAD_PAGE_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });
}
