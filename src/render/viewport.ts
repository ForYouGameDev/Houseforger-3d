import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Id } from '../core/ids';
import type { GeometryDef, Project, SceneNode } from '../core/project';
import type { ViewName } from '../editor/store';

export class ViewportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewportUnavailableError';
  }
}

export interface AxisInfo {
  axis: 'x' | 'y' | 'z';
  negative: boolean;
  /** Screen-space direction, x right, y up, both in [-1, 1]. */
  x: number;
  y: number;
  /** Positive = pointing towards the viewer. */
  depth: number;
}

export interface ViewportEvents {
  onPick(id: Id | null, additive: boolean): void;
  onOrientation(axes: AxisInfo[]): void;
  onProblem(message: string): void;
}

const CLICK_MAX_MOVE_PX = 5;
const CLICK_MAX_MS = 500;

/** Cheap capability check so the UI can show a friendly message instead of a blank canvas. */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function createRenderer(): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (e) {
    throw new ViewportUnavailableError(
      e instanceof Error ? `Could not start 3D graphics: ${e.message}` : 'Could not start 3D graphics.',
    );
  }
}

export class Viewport {
  private readonly host: HTMLElement;
  private readonly events: ViewportEvents;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly content = new THREE.Group();
  private readonly grid: THREE.GridHelper;
  private readonly axes: THREE.AxesHelper;
  private readonly selectionHelpers = new THREE.Group();
  private readonly perspective: THREE.PerspectiveCamera;
  private readonly orthographic: THREE.OrthographicCamera;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();

  private readonly objects = new Map<Id, THREE.Object3D>();
  private readonly materials = new Map<Id, THREE.MeshStandardMaterial>();
  private project: Project | null = null;
  private selection: Id[] = [];

  private width = 1;
  private height = 1;
  private frameRequested = false;
  private disposed = false;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private lastAxisKey = '';

  constructor(host: HTMLElement, events: ViewportEvents) {
    if (!isWebGLAvailable()) {
      throw new ViewportUnavailableError('3D graphics (WebGL) is not available on this device or browser.');
    }
    this.host = host;
    this.events = events;

    this.renderer = createRenderer();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x161a21, 1);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '3D view of your building');
    host.appendChild(canvas);

    // Lighting + helpers
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x3a3f4a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(8, 14, 6);
    this.scene.add(sun);
    this.grid = new THREE.GridHelper(40, 40, 0x5a6475, 0x2c333f);
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(1.5);
    this.scene.add(this.axes);
    this.scene.add(this.content);
    this.scene.add(this.selectionHelpers);

    // Cameras
    this.perspective = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
    this.orthographic = new THREE.OrthographicCamera(-5, 5, 5, -5, -2000, 2000);
    this.perspective.position.set(7, 6, 9);
    this.camera = this.perspective;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false; // render-on-demand friendly
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 500;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', this.onControlsChange);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.requestRender();
  }

  // ------------------------------------------------------------ public API

  setProject(project: Project): void {
    this.project = project;
    this.syncScene();
    this.rebuildSelection();
    this.requestRender();
  }

  setSelection(ids: Id[]): void {
    this.selection = ids;
    this.rebuildSelection();
    this.requestRender();
  }

  setProjection(mode: 'perspective' | 'orthographic'): void {
    const target = mode === 'orthographic' ? this.orthographic : this.perspective;
    if (target === this.camera) return;
    const from = this.camera;
    const dist = Math.max(from.position.distanceTo(this.controls.target), 0.5);
    target.position.copy(from.position);
    target.quaternion.copy(from.quaternion);
    this.camera = target;
    this.controls.object = target;
    this.updateOrthoFrustum(dist);
    this.controls.update();
    this.emitOrientation(true);
    this.requestRender();
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
    this.axes.visible = visible;
    this.requestRender();
  }

  /** Looks at the current target from one of the six standard directions. */
  setView(view: ViewName): void {
    const dist = Math.max(this.camera.position.distanceTo(this.controls.target), 2);
    const dir = new THREE.Vector3();
    switch (view) {
      case 'front':
        dir.set(0, 0, 1);
        break;
      case 'back':
        dir.set(0, 0, -1);
        break;
      case 'right':
        dir.set(1, 0, 0);
        break;
      case 'left':
        dir.set(-1, 0, 0);
        break;
      case 'top':
        dir.set(0, 1, 0.0001);
        break;
      case 'bottom':
        dir.set(0, -1, 0.0001);
        break;
    }
    dir.normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
    this.emitOrientation(true);
    this.requestRender();
  }

  /** Default 3/4 view looking at the whole model. */
  resetView(): void {
    this.camera.up.set(0, 1, 0);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(7, 6, 9);
    this.controls.update();
    this.frame();
  }

  /** Fits the camera around the selected parts, or the whole model when nothing is selected. */
  frame(ids: Id[] = this.selection): void {
    const box = new THREE.Box3();
    const source: THREE.Object3D[] = [];
    if (ids.length > 0) {
      for (const id of ids) {
        const o = this.objects.get(id);
        if (o) source.push(o);
      }
    }
    if (source.length === 0) source.push(this.content);
    for (const o of source) {
      o.updateWorldMatrix(true, true);
      box.expandByObject(o);
    }
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 2.5, 3));
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.75);

    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.8, 1.2);
    dir.normalize();

    let dist: number;
    if (this.camera instanceof THREE.PerspectiveCamera) {
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      dist = (radius / Math.sin(fov / 2)) * 1.1;
    } else {
      dist = radius * 3;
    }
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.updateOrthoFrustum(dist);
    this.controls.update();
    this.emitOrientation(true);
    this.requestRender();
  }

  /** Point on the ground (y = 0) under the orbit target; used to place new parts where you are looking. */
  getGroundTarget(): [number, number, number] {
    const t = this.controls.target;
    return [Math.round(t.x * 10) / 10, 0, Math.round(t.z * 10) / 10];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.controls.removeEventListener('change', this.onControlsChange);
    this.controls.dispose();

    for (const o of [...this.objects.values()]) this.disposeObject(o);
    this.objects.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.clearSelectionHelpers();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.axes.geometry.dispose();
    (this.axes.material as THREE.Material).dispose();

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  // ---------------------------------------------------------- scene syncing

  private syncScene(): void {
    const p = this.project;
    if (!p) return;

    // Materials
    for (const def of Object.values(p.materials)) {
      let m = this.materials.get(def.id);
      if (!m) {
        m = new THREE.MeshStandardMaterial();
        this.materials.set(def.id, m);
      }
      m.color.set(def.color);
      m.roughness = def.roughness;
      m.metalness = def.metalness;
    }
    for (const [id, m] of [...this.materials]) {
      if (!p.materials[id]) {
        m.dispose();
        this.materials.delete(id);
      }
    }

    // Remove objects that no longer exist
    for (const [id, o] of [...this.objects]) {
      if (!p.nodes[id] || id === p.rootId) {
        o.removeFromParent();
        this.disposeObject(o, false);
        this.objects.delete(id);
      }
    }

    // Create/update from the root down so parents exist before children
    const visit = (node: SceneNode, parent: THREE.Object3D) => {
      let obj = this.objects.get(node.id);
      if (!obj) {
        obj = node.kind === 'mesh' ? new THREE.Mesh() : new THREE.Group();
        obj.userData.nodeId = node.id;
        this.objects.set(node.id, obj);
      }
      if (obj.parent !== parent) parent.add(obj);

      obj.name = node.name;
      obj.visible = node.visible;
      obj.position.set(...node.transform.position);
      obj.rotation.set(node.transform.rotation[0], node.transform.rotation[1], node.transform.rotation[2], 'XYZ');
      obj.scale.set(...node.transform.scale);

      if (obj instanceof THREE.Mesh && node.geometry) {
        const key = JSON.stringify(node.geometry);
        if (obj.userData.geomKey !== key) {
          obj.geometry.dispose();
          obj.geometry = this.buildGeometry(node.geometry);
          obj.userData.geomKey = key;
        }
        const mat = node.materialId ? this.materials.get(node.materialId) : undefined;
        if (mat && obj.material !== mat) obj.material = mat;
      }
      for (const childId of node.children) visit(p.nodes[childId], obj);
    };
    for (const childId of p.nodes[p.rootId].children) visit(p.nodes[childId], this.content);
  }

  private buildGeometry(g: GeometryDef): THREE.BufferGeometry {
    if (g.type === 'box') return new THREE.BoxGeometry(g.width, g.height, g.depth);
    return new THREE.CylinderGeometry(g.radius, g.radius, g.height, g.segments);
  }

  /** Frees GPU memory owned by an object. Materials are shared and disposed separately. */
  private disposeObject(o: THREE.Object3D, recursive = true): void {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
    if (recursive) o.children.forEach((c) => this.disposeObject(c, true));
  }

  // ------------------------------------------------------ selection overlay

  private clearSelectionHelpers(): void {
    for (const h of [...this.selectionHelpers.children]) {
      this.selectionHelpers.remove(h);
      if (h instanceof THREE.Box3Helper) {
        h.geometry.dispose();
        (h.material as THREE.Material).dispose();
      }
    }
  }

  private rebuildSelection(): void {
    this.clearSelectionHelpers();
    for (const id of this.selection) {
      const o = this.objects.get(id);
      if (!o) continue;
      o.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) continue;
      this.selectionHelpers.add(new THREE.Box3Helper(box, new THREE.Color(0xffa63d)));
    }
  }

  // ------------------------------------------------------------ interaction

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || e.button > 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > CLICK_MAX_MOVE_PX || performance.now() - down.t > CLICK_MAX_MS) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.content, true);
    for (const hit of hits) {
      if (!this.isVisible(hit.object)) continue;
      const id = this.findNodeId(hit.object);
      if (id) {
        this.events.onPick(id, e.shiftKey || e.ctrlKey || e.metaKey);
        return;
      }
    }
    this.events.onPick(null, e.shiftKey || e.ctrlKey || e.metaKey);
  };

  private isVisible(o: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = o;
    while (cur && cur !== this.content) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  }

  private findNodeId(o: THREE.Object3D): Id | null {
    let cur: THREE.Object3D | null = o;
    while (cur) {
      if (typeof cur.userData.nodeId === 'string') return cur.userData.nodeId as Id;
      cur = cur.parent;
    }
    return null;
  }

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.events.onProblem('The 3D view was interrupted by the device. Trying to recover…');
  };

  private readonly onContextRestored = (): void => {
    for (const m of this.materials.values()) m.needsUpdate = true;
    this.requestRender();
  };

  private readonly onControlsChange = (): void => {
    this.emitOrientation(false);
    this.requestRender();
  };

  // ------------------------------------------------------------- rendering

  private resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, Math.floor(this.host.clientWidth));
    const h = Math.max(1, Math.floor(this.host.clientHeight));
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.perspective.aspect = w / h;
    this.perspective.updateProjectionMatrix();
    this.updateOrthoFrustum(this.camera.position.distanceTo(this.controls.target));
    this.requestRender();
  }

  private updateOrthoFrustum(distance: number): void {
    const aspect = this.width / this.height;
    const halfH = Math.max(distance, 0.5) * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    this.orthographic.left = -halfH * aspect;
    this.orthographic.right = halfH * aspect;
    this.orthographic.top = halfH;
    this.orthographic.bottom = -halfH;
    this.orthographic.updateProjectionMatrix();
  }

  private requestRender(): void {
    if (this.frameRequested || this.disposed) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      if (this.disposed) return;
      this.renderer.render(this.scene, this.camera);
    });
  }

  private emitOrientation(force: boolean): void {
    this.camera.updateMatrixWorld();
    const inv = this.camera.matrixWorldInverse;
    const dirs: Array<[AxisInfo['axis'], boolean, THREE.Vector3]> = [
      ['x', false, new THREE.Vector3(1, 0, 0)],
      ['x', true, new THREE.Vector3(-1, 0, 0)],
      ['y', false, new THREE.Vector3(0, 1, 0)],
      ['y', true, new THREE.Vector3(0, -1, 0)],
      ['z', false, new THREE.Vector3(0, 0, 1)],
      ['z', true, new THREE.Vector3(0, 0, -1)],
    ];
    const axes: AxisInfo[] = dirs.map(([axis, negative, v]) => {
      const c = v.clone().transformDirection(inv);
      return { axis, negative, x: c.x, y: c.y, depth: c.z };
    });
    const key = axes.map((a) => `${a.x.toFixed(3)},${a.y.toFixed(3)}`).join('|');
    if (!force && key === this.lastAxisKey) return;
    this.lastAxisKey = key;
    this.events.onOrientation(axes);
  }
}
