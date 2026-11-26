import * as THREE from 'three';
import { CINEMATIC_LIGHTING } from '../shaders/pageCurl.glsl';

export interface SceneManagerOptions {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
}

export interface SceneLights {
  keyLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  fillLight: THREE.DirectionalLight;
  spotLight: THREE.SpotLight;
  underTableLight: THREE.PointLight;
  underFrontLight: THREE.PointLight;
}

/**
 * Manages the WebGLRenderer, Three.js Scene, slate-blue atmospheric fog,
 * and the cinematic Golden Key + Cool Natural-Blue Fill lighting rig.
 */
export class SceneManager {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly lights: SceneLights;

  private readonly spotTarget: THREE.Object3D;
  private disposed = false;

  constructor(options: SceneManagerOptions) {
    const width = options.width ?? window.innerWidth;
    const height = options.height ?? window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CINEMATIC_LIGHTING.toneMappingExposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CINEMATIC_LIGHTING.backgroundHex);
    this.scene.fog = new THREE.FogExp2(
      CINEMATIC_LIGHTING.fogHex,
      CINEMATIC_LIGHTING.fogDensity,
    );

    // 1. Warm golden directional key light (upper-right / front) casting lush shadows
    const keyLight = new THREE.DirectionalLight(
      CINEMATIC_LIGHTING.keyColorHex,
      CINEMATIC_LIGHTING.keyIntensity,
    );
    keyLight.position.copy(CINEMATIC_LIGHTING.keyPosition);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.015;
    keyLight.shadow.radius = 2.6;
    keyLight.shadow.camera.near = 2.0;
    keyLight.shadow.camera.far = 28.0;
    keyLight.shadow.camera.left = -10.5;
    keyLight.shadow.camera.right = 10.5;
    keyLight.shadow.camera.top = 9.0;
    keyLight.shadow.camera.bottom = -9.0;
    this.scene.add(keyLight);

    // 2. Natural blue sky + warm kraft cardboard ground bounce hemisphere light
    const hemiLight = new THREE.HemisphereLight(
      CINEMATIC_LIGHTING.hemiSkyHex,
      CINEMATIC_LIGHTING.hemiGroundHex,
      CINEMATIC_LIGHTING.hemiIntensity,
    );
    this.scene.add(hemiLight);

    // 3. Cool natural-blue rim/fill directional light from opposite upper-left / back
    const fillLight = new THREE.DirectionalLight(
      CINEMATIC_LIGHTING.fillColorHex,
      CINEMATIC_LIGHTING.fillIntensity,
    );
    fillLight.position.copy(CINEMATIC_LIGHTING.fillPosition);
    this.scene.add(fillLight);

    // 4. Warm golden overhead spotlight pool over the newspaper spread
    const spotLight = new THREE.SpotLight(
      CINEMATIC_LIGHTING.spotColorHex,
      CINEMATIC_LIGHTING.spotIntensity,
      26.0,
      Math.PI * 0.34,
      0.88,
      1.5,
    );
    spotLight.position.copy(CINEMATIC_LIGHTING.spotPosition);
    this.spotTarget = new THREE.Object3D();
    this.spotTarget.position.set(0.0, 0.0, 0.1);
    this.scene.add(this.spotTarget);
    spotLight.target = this.spotTarget;
    this.scene.add(spotLight);

    // 5. Cool natural-blue under-table point lights illuminating floating text beneath & around the slab
    const underTableLight = new THREE.PointLight(
      CINEMATIC_LIGHTING.underLightHex,
      CINEMATIC_LIGHTING.underLightIntensity,
      24.0,
      1.3,
    );
    underTableLight.position.copy(CINEMATIC_LIGHTING.underLightPosition);
    this.scene.add(underTableLight);

    const underFrontLight = new THREE.PointLight(
      CINEMATIC_LIGHTING.underFrontLightHex,
      CINEMATIC_LIGHTING.underFrontLightIntensity,
      20.0,
      1.35,
    );
    underFrontLight.position.copy(CINEMATIC_LIGHTING.underFrontLightPosition);
    this.scene.add(underFrontLight);

    this.lights = {
      keyLight,
      hemiLight,
      fillLight,
      spotLight,
      underTableLight,
      underFrontLight,
    };
  }

  public add(...objects: THREE.Object3D[]): void {
    this.scene.add(...objects);
  }

  public resize(width: number, height: number): void {
    if (this.disposed) return;
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
  }

  public render(camera: THREE.Camera): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, camera);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lights.keyLight.shadow.map?.dispose();
    this.renderer.dispose();
  }
}
