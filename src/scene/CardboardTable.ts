import * as THREE from 'three';
import {
  CARDBOARD_COLORS,
  TABLE_DEPTH,
  TABLE_THICKNESS,
  TABLE_TOP_Y,
  TABLE_WIDTH,
} from '../config/theme';
import type { CardboardTextureSet } from '../textures/cardboardTexture';

/**
 * Physical corrugated cardboard presentation table with top surface at Y = TABLE_TOP_Y (0),
 * wavy corrugated fluted edges along all 4 sides, and slim recessed dark-bronze trestle
 * rails underneath that preserve an open visual void below the slab for floating history text.
 */
export class CardboardTable {
  public readonly group: THREE.Group;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];

  constructor(textures: CardboardTextureSet) {
    this.group = new THREE.Group();
    this.group.name = 'CardboardTable';

    // Clone edge textures so long sides (width=16) and short sides (depth=11)
    // tile the corrugated flute waveform cleanly without horizontal stretching.
    const edgeLongMap = textures.edgeColorMap.clone();
    edgeLongMap.wrapS = THREE.RepeatWrapping;
    edgeLongMap.wrapT = THREE.ClampToEdgeWrapping;
    edgeLongMap.repeat.set(6.5, 1);
    edgeLongMap.colorSpace = THREE.SRGBColorSpace;
    edgeLongMap.needsUpdate = true;
    this.ownedTextures.push(edgeLongMap);

    const edgeShortMap = textures.edgeColorMap.clone();
    edgeShortMap.wrapS = THREE.RepeatWrapping;
    edgeShortMap.wrapT = THREE.ClampToEdgeWrapping;
    edgeShortMap.repeat.set(4.5, 1);
    edgeShortMap.colorSpace = THREE.SRGBColorSpace;
    edgeShortMap.needsUpdate = true;
    this.ownedTextures.push(edgeShortMap);

    // Top kraft linerboard surface
    const topMat = new THREE.MeshStandardMaterial({
      map: textures.colorMap,
      bumpMap: textures.bumpMap,
      bumpScale: 0.032,
      roughnessMap: textures.roughnessMap,
      roughness: 0.92,
      metalness: 0.02,
    });

    // Bottom kraft linerboard surface (slightly warmer/deeper underside bounce)
    const bottomMat = new THREE.MeshStandardMaterial({
      map: textures.colorMap,
      bumpMap: textures.bumpMap,
      bumpScale: 0.02,
      color: new THREE.Color(0xc5b39b),
      roughness: 0.95,
      metalness: 0.01,
    });

    // Corrugated fluted side edge materials (+X/-X short sides, +Z/-Z long sides)
    const edgeShortMat = new THREE.MeshStandardMaterial({
      map: edgeShortMap,
      roughness: 0.94,
      metalness: 0.02,
    });

    const edgeLongMat = new THREE.MeshStandardMaterial({
      map: edgeLongMap,
      roughness: 0.94,
      metalness: 0.02,
    });

    this.materials.push(topMat, bottomMat, edgeShortMat, edgeLongMat);

    // BoxGeometry material order: [+X, -X, +Y (top), -Y (bottom), +Z, -Z]
    const slabGeo = new THREE.BoxGeometry(
      TABLE_WIDTH,
      TABLE_THICKNESS,
      TABLE_DEPTH,
    );
    this.geometries.push(slabGeo);

    const slabMesh = new THREE.Mesh(slabGeo, [
      edgeShortMat,
      edgeShortMat,
      topMat,
      bottomMat,
      edgeLongMat,
      edgeLongMat,
    ]);
    slabMesh.position.set(0, TABLE_TOP_Y - TABLE_THICKNESS * 0.5, 0);
    slabMesh.receiveShadow = true;
    slabMesh.castShadow = true;
    slabMesh.name = 'CardboardSlab';
    this.group.add(slabMesh);

    // Subtle crisp kraft top/bottom edge trim strips framing the corrugated flutes
    const linerLipMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(CARDBOARD_COLORS.edgeCut),
      roughness: 0.92,
      metalness: 0.02,
    });
    this.materials.push(linerLipMat);

    const lipThickness = 0.014;
    const lipOutset = 0.004;
    const topLipGeo = new THREE.BoxGeometry(
      TABLE_WIDTH + lipOutset * 2,
      lipThickness,
      TABLE_DEPTH + lipOutset * 2,
    );
    this.geometries.push(topLipGeo);

    // Thin top & bottom liner overhang borders (placed slightly recessed below Y=0 so top texture stays unbroken)
    const bottomLipMesh = new THREE.Mesh(topLipGeo, linerLipMat);
    bottomLipMesh.position.set(
      0,
      TABLE_TOP_Y - TABLE_THICKNESS + lipThickness * 0.5,
      0,
    );
    bottomLipMesh.receiveShadow = true;
    this.group.add(bottomLipMesh);

    // Slim recessed vintage dark-bronze / charcoal trestle frame far underneath
    // Leaves a generous open dark-blue void beneath the table for floating history typography!
    const frameMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x2a241e),
      roughness: 0.52,
      metalness: 0.62,
    });
    const brassTrimMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x8a6d3f),
      roughness: 0.38,
      metalness: 0.78,
    });
    this.materials.push(frameMat, brassTrimMat);

    const railY = TABLE_TOP_Y - TABLE_THICKNESS - 0.11;
    const insetX = TABLE_WIDTH * 0.5 - 2.3;
    const insetZ = TABLE_DEPTH * 0.5 - 1.9;
    const railSize = 0.11;

    const longRailGeo = new THREE.BoxGeometry(insetX * 2, railSize, railSize);
    const shortRailGeo = new THREE.BoxGeometry(railSize, railSize, insetZ * 2);
    this.geometries.push(longRailGeo, shortRailGeo);

    const frontRail = new THREE.Mesh(longRailGeo, frameMat);
    frontRail.position.set(0, railY, insetZ);
    const backRail = new THREE.Mesh(longRailGeo, frameMat);
    backRail.position.set(0, railY, -insetZ);

    const leftRail = new THREE.Mesh(shortRailGeo, frameMat);
    leftRail.position.set(-insetX, railY, 0);
    const rightRail = new THREE.Mesh(shortRailGeo, frameMat);
    rightRail.position.set(insetX, railY, 0);

    this.group.add(frontRail, backRail, leftRail, rightRail);

    // Slim recessed corner legs descending into the atmospheric fog far from center
    const legHeight = 6.2;
    const legGeo = new THREE.CylinderGeometry(0.06, 0.048, legHeight, 12);
    const collarGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.12, 12);
    this.geometries.push(legGeo, collarGeo);

    const legPositions: Array<[number, number]> = [
      [-insetX, -insetZ],
      [insetX, -insetZ],
      [-insetX, insetZ],
      [insetX, insetZ],
    ];

    for (const [lx, lz] of legPositions) {
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(lx, railY - legHeight * 0.5, lz);
      this.group.add(leg);

      const collar = new THREE.Mesh(collarGeo, brassTrimMat);
      collar.position.set(lx, railY - 0.08, lz);
      this.group.add(collar);
    }
  }

  public dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.ownedTextures) t.dispose();
  }
}
