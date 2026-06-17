import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { GUI } from 'lil-gui';

const COMPONENTS = ['all-components', 'mx', 'my', 'mz'];
const COLORMAPS = ['coolwarm', 'viridis', 'plasma', 'hsv', 'gray'];
const COMPONENT_INDEX = { mx: 0, my: 1, mz: 2 };
const ZERO_SPIN_EPS2 = 1e-16;

export default class Visualization {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.controlPanel = document.getElementById(options.controlPanelId);
    this.onStatus = options.onStatus || (() => {});
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf3f4f6);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.controls = null;
    this.gui = null;
    this.visData = null;
    this.scale = 1;
    this.center = [0, 0, 0];
    this.scaledDimensions = [1, 1, 1];
    this.meshGroup = new THREE.Group();
    this.arrowGroup = new THREE.Group();
    this.sliceGroup = new THREE.Group();
    this.isoGroup = new THREE.Group();
    this.axesScene = null;
    this.axesCamera = null;
    this.scene.add(this.meshGroup, this.arrowGroup, this.sliceGroup, this.isoGroup);

    this.settings = {
      showGrid: true,
      meshMode: 'outline',
      showArrows: true,
      sampleNx: 16,
      sampleNy: 16,
      sampleNz: 9,
      arrowMode: 'all',
      arrowLayerDirection: 'z',
      arrowLayerIndex: 1,
      arrowSize: 2.0,
      arrowComponent: 'mx',
      arrowColormap: 'viridis',
      showSlice: true,
      sliceDirection: 'z',
      slicePosition: 1,
      sliceComponent: 'all-components',
      sliceColormap: 'hsv',
      showIsosurface: false,
      isoComponent: 'mz',
      isoValue: 0,
      isoResolution: 56
    };

    this.init();
  }

  init() {
    if (!this.container) {
      throw new Error('Viewer container not found.');
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.camera.position.set(7, -10, 7);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const light = new THREE.DirectionalLight(0xffffff, 1.3);
    light.position.set(5, -7, 8);
    this.scene.add(light);

    this.gridHelper = new THREE.GridHelper(12, 24, 0x94a3b8, 0xd1d5db);
    this.gridHelper.rotation.x = Math.PI / 2;
    this.scene.add(this.gridHelper);
    this.initAxesGizmo();

    this.initGUI();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  initAxesGizmo() {
    this.axesScene = new THREE.Scene();
    this.axesScene.background = null;
    this.axesCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
    this.axesScene.add(new THREE.AmbientLight(0xffffff, 1.4));

    const length = 1.35;
    const axes = [
      { label: 'X', dir: new THREE.Vector3(1, 0, 0), color: 0xef4444 },
      { label: 'Y', dir: new THREE.Vector3(0, 1, 0), color: 0x22c55e },
      { label: 'Z', dir: new THREE.Vector3(0, 0, 1), color: 0x111827 }
    ];

    for (const axis of axes) {
      this.axesScene.add(createThickAxisArrow(axis.dir, axis.color, length));
      const label = createAxisLabel(axis.label, axis.color);
      label.position.copy(axis.dir).multiplyScalar(length + 0.28);
      this.axesScene.add(label);
    }
  }

  updateFromVisData(visData) {
    this.visData = visData;
    const { mesh, coordinates } = visData;
    const ranges = [
      coordinates.x[coordinates.x.length - 1] - coordinates.x[0],
      coordinates.y[coordinates.y.length - 1] - coordinates.y[0],
      coordinates.z[coordinates.z.length - 1] - coordinates.z[0]
    ].map((value, i) => Math.abs(value) || Math.max(1, [mesh.nx, mesh.ny, mesh.nz][i] - 1));

    this.scale = 12 / Math.max(...ranges);
    this.center = [
      (coordinates.x[0] + coordinates.x[coordinates.x.length - 1]) / 2,
      (coordinates.y[0] + coordinates.y[coordinates.y.length - 1]) / 2,
      (coordinates.z[0] + coordinates.z[coordinates.z.length - 1]) / 2
    ];
    this.scaledDimensions = ranges.map((value) => value * this.scale);
    this.settings.slicePosition = Math.ceil(mesh.nz / 2);
    this.settings.arrowLayerIndex = Math.ceil(mesh.nz / 2);

    this.updateSliceRange();
    this.updateArrowLayerRange();
    this.drawMesh();
    this.drawArrows();
    this.drawSlice();
    this.drawIsosurface();
    this.frameScene();
  }

  initGUI() {
    this.gui = new GUI({ title: 'Visualization Controls', container: this.controlPanel });

    const display = this.gui.addFolder('Display');
    display.add(this.settings, 'showGrid').name('Show Grid').onChange((value) => {
      this.gridHelper.visible = value;
    });
    display.add(this.settings, 'meshMode', ['outline', 'box', 'hidden']).name('Mesh').onChange(() => this.drawMesh());
    display.open();

    const arrows = this.gui.addFolder('Arrows');
    arrows.add(this.settings, 'showArrows').name('Show Arrows').onChange(() => this.drawArrows());
    arrows.add(this.settings, 'arrowMode', ['all', 'layer']).name('Mode').onChange(() => {
      this.updateArrowLayerRange();
      this.drawArrows();
    });
    arrows.add(this.settings, 'arrowLayerDirection', ['x', 'y', 'z']).name('Direction').onChange(() => {
      this.resetArrowLayerIndex();
      this.updateArrowLayerRange();
      this.drawArrows();
    });
    this.arrowLayerIndexControl = arrows.add(this.settings, 'arrowLayerIndex', 1, 2, 1).name('Index').onChange(() => this.drawArrows());
    arrows.add(this.settings, 'sampleNx', 1, 64, 1).name('Nx').onFinishChange(() => this.drawArrows());
    arrows.add(this.settings, 'sampleNy', 1, 64, 1).name('Ny').onFinishChange(() => this.drawArrows());
    arrows.add(this.settings, 'sampleNz', 1, 64, 1).name('Nz').onFinishChange(() => this.drawArrows());
    arrows.add(this.settings, 'arrowSize', 0.2, 2.5, 0.05).name('Size').onChange(() => this.drawArrows());
    arrows.add(this.settings, 'arrowComponent', ['mx', 'my', 'mz']).name('Component').onChange(() => this.drawArrows());
    arrows.add(this.settings, 'arrowColormap', COLORMAPS).name('Colormap').onChange(() => this.drawArrows());
    arrows.open();

    const slice = this.gui.addFolder('Slice');
    slice.add(this.settings, 'showSlice').name('Show Slice').onChange(() => this.drawSlice());
    this.sliceDirectionControl = slice.add(this.settings, 'sliceDirection', ['x', 'y', 'z']).name('Direction').onChange(() => {
      this.updateSliceRange();
      this.drawSlice();
    });
    this.slicePositionControl = slice.add(this.settings, 'slicePosition', 1, 2, 1).name('Index').onChange(() => this.drawSlice());
    slice.add(this.settings, 'sliceComponent', COMPONENTS).name('Component').onChange(() => {
      this.drawSlice();
      this.drawArrows();
    });
    slice.add(this.settings, 'sliceColormap', COLORMAPS).name('Colormap').onChange(() => {
      this.drawSlice();
      this.drawArrows();
    });
    slice.open();

    const iso = this.gui.addFolder('Isosurface');
    iso.add(this.settings, 'showIsosurface').name('Show').onChange(() => {
      this.drawIsosurface();
    });
    iso.add(this.settings, 'isoComponent', ['mx', 'my', 'mz']).name('Component').onChange(() => {
      this.drawIsosurface();
    });
    iso.add(this.settings, 'isoValue', -1, 1, 0.01).name('Value').onChange(() => {
      this.drawIsosurface();
    });
    iso.add(this.settings, 'isoResolution', 24, 96, 1).name('Resolution').onFinishChange(() => this.drawIsosurface());
  }

  updateSliceRange() {
    if (!this.visData || !this.slicePositionControl) return;
    const { nx, ny, nz } = this.visData.mesh;
    const maxIndex = this.settings.sliceDirection === 'x' ? nx : this.settings.sliceDirection === 'y' ? ny : nz;
    this.settings.slicePosition = Math.min(Math.max(1, Math.round(this.settings.slicePosition)), maxIndex);
    this.slicePositionControl.min(1).max(maxIndex).setValue(this.settings.slicePosition);
  }

  updateArrowLayerRange() {
    if (!this.visData || !this.arrowLayerIndexControl) return;
    const maxIndex = this.arrowLayerCount();
    this.settings.arrowLayerIndex = Math.min(Math.max(1, Math.round(this.settings.arrowLayerIndex)), maxIndex);
    this.arrowLayerIndexControl.min(1).max(maxIndex).setValue(this.settings.arrowLayerIndex);
  }

  resetArrowLayerIndex() {
    if (!this.visData) return;
    this.settings.arrowLayerIndex = Math.ceil(this.arrowLayerCount() / 2);
  }

  arrowLayerCount() {
    const { nx, ny, nz } = this.visData.mesh;
    if (this.settings.arrowLayerDirection === 'x') return nx;
    if (this.settings.arrowLayerDirection === 'y') return ny;
    return nz;
  }

  drawMesh() {
    clearGroup(this.meshGroup);
    if (!this.visData || this.settings.meshMode === 'hidden') return;

    const [x, y, z] = this.scaledDimensions;
    const geometry = new THREE.BoxGeometry(x, y, z);
    if (this.settings.meshMode === 'box') {
      const material = new THREE.MeshBasicMaterial({
        color: 0xaeb7c8,
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      this.meshGroup.add(new THREE.Mesh(geometry, material));
    }

    const edges = new THREE.EdgesGeometry(geometry);
    const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x64748b }));
    this.meshGroup.add(lines);
  }

  drawArrows() {
    clearGroup(this.arrowGroup);
    if (!this.visData || !this.settings.showArrows) return;

    const { mesh, spin } = this.visData;
    const samples = this.arrowSamples(
      sampleIndices(mesh.nx, this.settings.sampleNx),
      sampleIndices(mesh.ny, this.settings.sampleNy),
      sampleIndices(mesh.nz, this.settings.sampleNz)
    );
    const count = samples[0].length * samples[1].length * samples[2].length;
    if (count === 0) return;

    const minCell = Math.min(
      this.scaledDimensions[0] / Math.max(1, mesh.nx - 1),
      this.scaledDimensions[1] / Math.max(1, mesh.ny - 1),
      this.scaledDimensions[2] / Math.max(1, mesh.nz - 1)
    );
    const scale = Math.max(minCell * this.settings.arrowSize * 2.4, 0.035);
    const cylinderHeight = 0.4;
    const coneHeight = 0.3;
    const totalLength = cylinderHeight + coneHeight;
    const shaftGeometry = new THREE.CylinderGeometry(0.085, 0.085, cylinderHeight, 32);
    shaftGeometry.translate(0, -cylinderHeight / 2, 0);
    const coneGeometry = new THREE.ConeGeometry(0.21, coneHeight, 32);
    coneGeometry.translate(0, coneHeight / 2, 0);
    const material = new THREE.MeshStandardMaterial({
      metalness: 0.3,
      roughness: 0.4
    });
    const shafts = new THREE.InstancedMesh(shaftGeometry, material, count);
    const cones = new THREE.InstancedMesh(coneGeometry, material, count);
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const shaftPosition = new THREE.Vector3();
    const conePosition = new THREE.Vector3();
    const scalar = new THREE.Vector3(scale, scale, scale);
    const color = new THREE.Color();
    const componentOffset = COMPONENT_INDEX[this.settings.arrowComponent];
    const halfLength = (totalLength * scale) / 2;
    let instance = 0;

    for (const k of samples[2]) {
      for (const j of samples[1]) {
        for (const i of samples[0]) {
          const idx = i + j * mesh.nx + k * mesh.nx * mesh.ny;
          const base = idx * 3;
          dir.set(spin[base], spin[base + 1], spin[base + 2]);
          if (dir.lengthSq() <= ZERO_SPIN_EPS2) continue;
          dir.normalize();

          position.copy(this.pointPosition(i, j, k));
          const arrowBase = position.clone().addScaledVector(dir, -halfLength);
          shaftPosition.copy(arrowBase).addScaledVector(dir, cylinderHeight * scale);
          conePosition.copy(arrowBase).addScaledVector(dir, cylinderHeight * scale);
          quat.setFromUnitVectors(up, dir);

          matrix.compose(shaftPosition, quat, scalar);
          shafts.setMatrixAt(instance, matrix);
          matrix.compose(conePosition, quat, scalar);
          cones.setMatrixAt(instance, matrix);

          color.copy(arrowComponentColor(spin[base + componentOffset], this.settings.arrowColormap));
          shafts.setColorAt(instance, color);
          cones.setColorAt(instance, color);
          instance += 1;
        }
      }
    }

    shafts.instanceMatrix.needsUpdate = true;
    cones.instanceMatrix.needsUpdate = true;
    shafts.instanceColor.needsUpdate = true;
    cones.instanceColor.needsUpdate = true;
    shafts.count = instance;
    cones.count = instance;
    if (instance === 0) {
      shaftGeometry.dispose();
      coneGeometry.dispose();
      material.dispose();
      return;
    }
    this.arrowGroup.add(shafts, cones);
  }

  arrowSamples(sampleX, sampleY, sampleZ) {
    if (!this.visData || this.settings.arrowMode === 'all') {
      return [sampleX, sampleY, sampleZ];
    }

    const layerIndex = Math.min(
      this.arrowLayerCount() - 1,
      Math.max(0, Math.round(this.settings.arrowLayerIndex) - 1)
    );
    if (this.settings.arrowLayerDirection === 'x') {
      return [[layerIndex], sampleY, sampleZ];
    }
    if (this.settings.arrowLayerDirection === 'y') {
      return [sampleX, [layerIndex], sampleZ];
    }
    return [sampleX, sampleY, [layerIndex]];
  }

  drawSlice() {
    clearGroup(this.sliceGroup);
    if (!this.visData || !this.settings.showSlice) return;

    const { mesh, spin } = this.visData;
    const axis = this.settings.sliceDirection;
    const component = this.settings.sliceComponent;
    const maxIndex = axis === 'x' ? mesh.nx : axis === 'y' ? mesh.ny : mesh.nz;
    const slice = Math.min(Math.max(0, Math.round(this.settings.slicePosition) - 1), maxIndex - 1);
    const size = axis === 'x' ? [mesh.ny, mesh.nz] : axis === 'y' ? [mesh.nx, mesh.nz] : [mesh.nx, mesh.ny];
    const imageData = new ImageData(size[0], size[1]);

    for (let v = 0; v < size[1]; v += 1) {
      for (let u = 0; u < size[0]; u += 1) {
        const idx = axis === 'x'
          ? slice + u * mesh.nx + v * mesh.nx * mesh.ny
          : axis === 'y'
            ? u + slice * mesh.nx + v * mesh.nx * mesh.ny
            : u + v * mesh.nx + slice * mesh.nx * mesh.ny;
        const base = idx * 3;
        const outIndex = u + (size[1] - 1 - v) * size[0];
        if (isZeroSpin(spin[base], spin[base + 1], spin[base + 2])) {
          imageData.data[outIndex * 4 + 3] = 0;
          continue;
        }
        const color = spinColor(
          spin[base],
          spin[base + 1],
          spin[base + 2],
          component,
          this.settings.sliceColormap
        );
        imageData.data[outIndex * 4] = Math.round(color.r * 255);
        imageData.data[outIndex * 4 + 1] = Math.round(color.g * 255);
        imageData.data[outIndex * 4 + 2] = Math.round(color.b * 255);
        imageData.data[outIndex * 4 + 3] = 235;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = size[0];
    canvas.height = size[1];
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const dims = this.scaledDimensions;
    const geometry = new THREE.PlaneGeometry(
      axis === 'x' ? dims[1] : dims[0],
      axis === 'z' ? dims[1] : dims[2]
    );
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(geometry, material);
    if (axis === 'x') {
      orientPlane(plane, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
      plane.position.x = indexToCenteredPosition(slice, mesh.nx, dims[0]);
    } else if (axis === 'y') {
      orientPlane(plane, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
      plane.position.y = indexToCenteredPosition(slice, mesh.ny, dims[1]);
    } else {
      plane.position.z = indexToCenteredPosition(slice, mesh.nz, dims[2]);
    }
    this.sliceGroup.add(plane);
  }

  drawIsosurface() {
    clearGroup(this.isoGroup);
    if (!this.visData || !this.settings.showIsosurface) return;

    const { mesh, spin } = this.visData;
    const resolution = Math.max(12, Math.min(96, Math.round(this.settings.isoResolution)));
    const componentOffset = COMPONENT_INDEX[this.settings.isoComponent];
    const material = new THREE.MeshLambertMaterial({
      color: colorForValue(this.settings.isoValue, -1, 1, 'coolwarm'),
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide
    });
    const cubes = new MarchingCubes(resolution, material, false, false, 100000);
    cubes.isolation = this.settings.isoValue;
    cubes.reset();

    for (let z = 0; z < resolution; z += 1) {
      const srcZ = Math.min(mesh.nz - 1, Math.round((z / (resolution - 1)) * (mesh.nz - 1)));
      for (let y = 0; y < resolution; y += 1) {
        const srcY = Math.min(mesh.ny - 1, Math.round((y / (resolution - 1)) * (mesh.ny - 1)));
        for (let x = 0; x < resolution; x += 1) {
          const srcX = Math.min(mesh.nx - 1, Math.round((x / (resolution - 1)) * (mesh.nx - 1)));
          const idx = srcX + srcY * mesh.nx + srcZ * mesh.nx * mesh.ny;
          const base = idx * 3;
          const value = isZeroSpin(spin[base], spin[base + 1], spin[base + 2])
            ? Number.NaN
            : spin[base + componentOffset];
          cubes.setCell(x, y, z, value);
        }
      }
    }

    cubes.update();
    this.filterMaskedIsosurface(cubes);
    const vertexCount = cubes.geometry?.attributes?.position?.count || 0;
    if (vertexCount === 0) {
      this.onStatus(`No isosurface vertices at ${this.settings.isoComponent} = ${this.settings.isoValue}`);
      cubes.geometry?.dispose();
      material.dispose();
      return;
    }

    cubes.scale.set(this.scaledDimensions[0] / 2, this.scaledDimensions[1] / 2, this.scaledDimensions[2] / 2);
    this.isoGroup.add(cubes);
    this.onStatus(`Isosurface vertices: ${vertexCount}`);
  }

  filterMaskedIsosurface(cubes) {
    const geometry = cubes.geometry;
    const positions = geometry?.attributes?.position;
    if (!positions || !this.visData) return;

    const { mesh, spin } = this.visData;
    const positionArray = positions.array;
    const normalArray = geometry.attributes.normal?.array;
    const keepPositions = [];
    const keepNormals = [];
    const bounds = localPositionBounds(positionArray);

    for (let i = 0; i < positionArray.length; i += 9) {
      const valid =
        isValidIsoVertex(positionArray[i], positionArray[i + 1], positionArray[i + 2], bounds, mesh, spin) &&
        isValidIsoVertex(positionArray[i + 3], positionArray[i + 4], positionArray[i + 5], bounds, mesh, spin) &&
        isValidIsoVertex(positionArray[i + 6], positionArray[i + 7], positionArray[i + 8], bounds, mesh, spin);
      if (!valid) continue;

      for (let j = 0; j < 9; j += 1) keepPositions.push(positionArray[i + j]);
      if (normalArray) {
        for (let j = 0; j < 9; j += 1) keepNormals.push(normalArray[i + j]);
      }
    }

    const filtered = new THREE.BufferGeometry();
    filtered.setAttribute('position', new THREE.Float32BufferAttribute(keepPositions, 3));
    if (normalArray) {
      filtered.setAttribute('normal', new THREE.Float32BufferAttribute(keepNormals, 3));
    } else {
      filtered.computeVertexNormals();
    }
    geometry.dispose();
    cubes.geometry = filtered;
  }

  pointPosition(i, j, k) {
    const { coordinates } = this.visData;
    return new THREE.Vector3(
      (coordinates.x[i] - this.center[0]) * this.scale,
      (coordinates.y[j] - this.center[1]) * this.scale,
      (coordinates.z[k] - this.center[2]) * this.scale
    );
  }

  frameScene() {
    const radius = Math.max(...this.scaledDimensions) * 0.85;
    this.camera.position.set(radius * 0.9, -radius * 1.25, radius * 0.9);
    this.camera.near = Math.max(radius / 1000, 0.001);
    this.camera.far = radius * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.gridHelper.scale.setScalar(Math.max(...this.scaledDimensions) / 12);
    this.gridHelper.position.z = -this.scaledDimensions[2] / 2;
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.camera);
    this.renderAxesGizmo();
  }

  renderAxesGizmo() {
    if (!this.axesScene || !this.axesCamera) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const size = Math.max(150, Math.min(220, Math.floor(Math.min(width, height) * 0.28)));
    const margin = 48;
    const cameraDirection = this.camera.position.clone().sub(this.controls.target).normalize();
    this.axesCamera.position.copy(cameraDirection.multiplyScalar(8));
    this.axesCamera.up.copy(this.camera.up);
    this.axesCamera.lookAt(0, 0, 0);

    this.renderer.setScissorTest(true);
    this.renderer.setScissor(margin, margin, size, size);
    this.renderer.setViewport(margin, margin, size, size);
    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.axesScene, this.axesCamera);
    this.renderer.autoClear = previousAutoClear;
    this.renderer.setScissorTest(false);
  }
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.traverse?.((node) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        node.material.forEach((material) => material.dispose?.());
      } else {
        node.material?.dispose?.();
      }
    });
  }
}

function sampleIndices(total, requested) {
  const count = Math.max(1, Math.min(total, Math.round(requested)));
  if (count === 1) return [Math.floor((total - 1) / 2)];
  const step = (total - 1) / (count - 1);
  const indices = [];
  for (let i = 0; i < count; i += 1) {
    indices.push(Math.min(total - 1, Math.round(i * step)));
  }
  return [...new Set(indices)];
}

function indexToCenteredPosition(index, count, dimension) {
  if (count <= 1) return 0;
  return (index / (count - 1) - 0.5) * dimension;
}

function orientPlane(plane, localXDirection, localYDirection) {
  const xAxis = localXDirection.clone().normalize();
  const yAxis = localYDirection.clone().normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  plane.quaternion.setFromRotationMatrix(matrix);
}

function localPositionBounds(positionArray) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positionArray.length; i += 3) {
    minX = Math.min(minX, positionArray[i]);
    minY = Math.min(minY, positionArray[i + 1]);
    minZ = Math.min(minZ, positionArray[i + 2]);
    maxX = Math.max(maxX, positionArray[i]);
    maxY = Math.max(maxY, positionArray[i + 1]);
    maxZ = Math.max(maxZ, positionArray[i + 2]);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function isValidIsoVertex(x, y, z, bounds, mesh, spin) {
  const ix = normalizedPositionToIndex(x, bounds.minX, bounds.maxX, mesh.nx);
  const iy = normalizedPositionToIndex(y, bounds.minY, bounds.maxY, mesh.ny);
  const iz = normalizedPositionToIndex(z, bounds.minZ, bounds.maxZ, mesh.nz);
  const idx = ix + iy * mesh.nx + iz * mesh.nx * mesh.ny;
  const base = idx * 3;
  return !isZeroSpin(spin[base], spin[base + 1], spin[base + 2]);
}

function normalizedPositionToIndex(value, min, max, count) {
  if (count <= 1 || max <= min) return 0;
  const t = clamp((value - min) / (max - min));
  return Math.min(count - 1, Math.max(0, Math.round(t * (count - 1))));
}

function colorForValue(value, min, max, mapName) {
  const t = max === min ? 0.5 : clamp((value - min) / (max - min));
  if (mapName === 'gray') return new THREE.Color(t, t, t);
  if (mapName === 'hsv') return new THREE.Color().setHSL(1 - t, 0.95, 0.52);
  if (mapName === 'plasma') return gradient(t, ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921']);
  if (mapName === 'viridis') return gradient(t, ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']);
  return gradient(t, ['#3b4cc0', '#f7f7f7', '#b40426']);
}

function arrowComponentColor(value, colormap) {
  if (colormap === 'gray') {
    return colorForValue(value, 1, -1, 'gray');
  }
  return colorForValue(value, -1, 1, colormap);
}

function spinColor(mx, my, mz, component, colormap) {
  if (component === 'all-components') {
    const inplanePhase = paraviewInplanePhase(mx, my);
    const base = colorForValue(inplanePhase, 0, Math.PI * 2, colormap);
    const overlay = mz >= 0
      ? new THREE.Color(0x000000)
      : new THREE.Color(0xffffff);
    return base.lerp(overlay, clamp(Math.abs(mz)));
  }

  if (component === 'mz') {
    return colorForValue(mz, 1, -1, 'gray');
  }

  const offset = COMPONENT_INDEX[component] ?? 0;
  const value = offset === 0 ? mx : my;
  return colorForValue(value, -1, 1, colormap);
}

function isZeroSpin(mx, my, mz) {
  return mx * mx + my * my + mz * mz <= ZERO_SPIN_EPS2;
}

function paraviewInplanePhase(mx, my) {
  const twoPi = Math.PI * 2;
  const raw = -(Math.atan2(my, mx) + twoPi);
  return ((raw % twoPi) + twoPi) % twoPi;
}

function createThickAxisArrow(direction, color, length) {
  const group = new THREE.Group();
  const shaftLength = length * 0.74;
  const headLength = length * 0.26;
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false
  });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, shaftLength, 24), material);
  shaft.geometry.translate(0, shaftLength / 2, 0);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, headLength, 24), material);
  head.geometry.translate(0, shaftLength + headLength / 2, 0);
  group.add(shaft, head);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return group;
}

function createAxisLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#111827';
  context.lineWidth = 7;
  context.font = '700 54px Segoe UI, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.strokeText(text, 48, 50);
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.fillText(text, 48, 50);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.38, 0.38, 0.38);
  return sprite;
}

function gradient(t, stops) {
  const scaled = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const local = scaled - i;
  return new THREE.Color(stops[i]).lerp(new THREE.Color(stops[i + 1]), local);
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}
