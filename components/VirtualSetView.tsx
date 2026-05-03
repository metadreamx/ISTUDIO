import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  BoxIcon,
  CameraIcon,
  CircleIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  LayersIcon,
  MonitorPlayIcon,
  PaletteIcon,
  PlayIcon,
  SaveIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  StopCircleIcon,
  SunIcon,
  Trash2Icon,
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type {
  ImageState,
  Project,
  VirtualSetCamera,
  VirtualSetLighting,
  VirtualSetObject,
  VirtualSetObjectType,
  VirtualSetPreset,
  VirtualSetRender,
  VirtualSetScene,
  VirtualSetSkyPreset,
  VirtualSetStatus,
  VirtualSetTransform,
} from '../types';
import {
  getVirtualSetStatus,
  saveVirtualSetRender,
  sendVirtualSetCommand,
  startVirtualSetRuntime,
  stopVirtualSetRuntime,
} from '../services/db';

interface VirtualSetViewProps {
  project: Project | null;
  onUpdateProject: (project: Project) => void;
  onCreateProject?: (name: string, initialState?: Project['state']) => Promise<Project | null>;
  canCreateProjects: boolean;
  onUseRender: (image: ImageState, mode: 'reference' | 'background') => void;
}

type TransformMode = 'translate' | 'rotate' | 'scale';

interface VirtualSetViewportHandle {
  capture: (format: 'png' | 'jpeg' | 'webp', width: number, height: number) => string | null;
}

const presets: { id: VirtualSetPreset; label: string; description: string; color: string }[] = [
  { id: 'studio-cyc', label: 'Studio Cyc', description: 'Clean curved wall for fashion and portraits.', color: '#d8dde4' },
  { id: 'rooftop', label: 'Rooftop', description: 'Open city platform with sunset directionality.', color: '#546172' },
  { id: 'showroom', label: 'Showroom', description: 'Glossy product space with controlled reflections.', color: '#c9ced6' },
  { id: 'warehouse', label: 'Warehouse', description: 'Industrial set with darker mood and depth.', color: '#45413b' },
  { id: 'fashion-set', label: 'Fashion Set', description: 'Editorial stage with color-washed light.', color: '#7c69aa' },
  { id: 'product-stage', label: 'Product Stage', description: 'Simple platform and sweep for campaign stills.', color: '#e8e1d6' },
];

const skyOptions: { id: VirtualSetSkyPreset; label: string; background: string; ambient: string }[] = [
  { id: 'clear', label: 'Clear', background: '#9fbfe3', ambient: '#dbeafe' },
  { id: 'cloudy', label: 'Cloudy', background: '#8c98a5', ambient: '#e5e7eb' },
  { id: 'sunset', label: 'Sunset', background: '#d1865b', ambient: '#fed7aa' },
  { id: 'night', label: 'Night', background: '#111827', ambient: '#93c5fd' },
  { id: 'hdri', label: 'HDRI', background: '#5c6876', ambient: '#f1f5f9' },
];

const objectTools: { type: VirtualSetObjectType; label: string; icon: React.ReactNode }[] = [
  { type: 'cube', label: 'Cube', icon: <BoxIcon className="h-4 w-4" /> },
  { type: 'sphere', label: 'Sphere', icon: <CircleIcon className="h-4 w-4" /> },
  { type: 'cylinder', label: 'Cylinder', icon: <CircleIcon className="h-4 w-4" /> },
  { type: 'wall', label: 'Wall', icon: <SquareIcon className="h-4 w-4" /> },
  { type: 'platform', label: 'Platform', icon: <LayersIcon className="h-4 w-4" /> },
  { type: 'backdrop', label: 'Backdrop', icon: <MonitorPlayIcon className="h-4 w-4" /> },
];

const renderSizes = [
  { label: '1:1', width: 1600, height: 1600 },
  { label: '4:5', width: 1600, height: 2000 },
  { label: '9:16', width: 1440, height: 2560 },
  { label: '16:9', width: 1920, height: 1080 },
];

const defaultTransform = (overrides: Partial<VirtualSetTransform> = {}): VirtualSetTransform => ({
  x: 0,
  y: 0,
  z: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  ...overrides,
});

const createObject = (type: VirtualSetObjectType, index = 1, image?: ImageState | null): VirtualSetObject => {
  const baseColor: Record<VirtualSetObjectType, string> = {
    plane: '#d7dee8',
    wall: '#cfd7df',
    cube: '#a7f83b',
    sphere: '#38bdf8',
    cylinder: '#e879f9',
    backdrop: '#d8dde4',
    platform: '#24282d',
    'image-plane': '#ffffff',
  };

  const transforms: Partial<Record<VirtualSetObjectType, Partial<VirtualSetTransform>>> = {
    wall: { y: 1.5, z: -2.4, scaleX: 1.4, scaleY: 1, scaleZ: 1 },
    platform: { y: -0.12, scaleX: 1.35, scaleY: 1, scaleZ: 1.1 },
    backdrop: { y: 1.05, z: -1.55, scaleX: 1.25, scaleY: 1, scaleZ: 1 },
    'image-plane': { y: 1.5, z: -1.4, scaleX: 1.4, scaleY: 1, scaleZ: 1 },
  };

  return {
    id: `${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    name: image?.fileName || `${type.replace('-', ' ')} ${index}`,
    type,
    visible: true,
    locked: false,
    color: baseColor[type],
    roughness: 0.55,
    metallic: 0,
    transform: defaultTransform(transforms[type]),
    image: image || null,
  };
};

const defaultCamera = (): VirtualSetCamera => ({
  focalLength: 35,
  x: 4.7,
  y: 3,
  z: 6,
  targetX: 0,
  targetY: 1,
  targetZ: 0,
});

const defaultLighting = (skyPreset: VirtualSetSkyPreset = 'clear'): VirtualSetLighting => ({
  skyPreset,
  timeOfDay: 14,
  sunAngle: 38,
  sunIntensity: 1.1,
  fillIntensity: 0.5,
  rimIntensity: 0.35,
  colorTemperature: 5600,
  fog: 0.08,
});

const createScene = (preset: VirtualSetPreset = 'studio-cyc'): VirtualSetScene => {
  const presetColor = presets.find((item) => item.id === preset)?.color || '#d8dde4';
  const objects: VirtualSetObject[] = [
    createObject('platform', 1),
    createObject('backdrop', 1),
  ];

  if (preset === 'warehouse') {
    objects.push({ ...createObject('wall', 1), color: '#34302b', transform: defaultTransform({ x: -2.8, y: 1.5, z: -2, rotationY: 28 }) });
    objects.push({ ...createObject('cube', 1), color: '#62594c', transform: defaultTransform({ x: 1.8, y: 0.55, z: -0.6, scaleX: 1.2, scaleY: 1.1, scaleZ: 0.9 }) });
  } else if (preset === 'product-stage') {
    objects.push({ ...createObject('cylinder', 1), color: '#f6f1e8', transform: defaultTransform({ y: 0.25, scaleX: 1.2, scaleY: 0.5, scaleZ: 1.2 }) });
  } else if (preset === 'fashion-set') {
    objects.push({ ...createObject('wall', 1), color: '#7c69aa', transform: defaultTransform({ x: 2.4, y: 1.4, z: -1.3, rotationY: -34, scaleX: 0.8 }) });
  } else if (preset === 'rooftop') {
    objects.push({ ...createObject('cube', 1), color: '#4b5563', transform: defaultTransform({ x: -2.2, y: 0.35, z: -1.2, scaleX: 1.5, scaleY: 0.7, scaleZ: 0.5 }) });
  } else if (preset === 'showroom') {
    objects.push({ ...createObject('sphere', 1), color: '#e7eef7', metallic: 0.25, roughness: 0.28, transform: defaultTransform({ x: -1.6, y: 0.75, z: -0.5, scaleX: 0.9, scaleY: 0.9, scaleZ: 0.9 }) });
  }

  objects[1] = { ...objects[1], color: presetColor };

  return {
    id: `virtual-set-${Date.now()}`,
    name: presets.find((item) => item.id === preset)?.label || 'Virtual Set',
    preset,
    width: 1920,
    height: 1080,
    backgroundColor: presetColor,
    selectedObjectId: objects[1]?.id || null,
    objects,
    camera: defaultCamera(),
    lighting: defaultLighting(preset === 'rooftop' || preset === 'fashion-set' ? 'sunset' : 'clear'),
    renders: [],
    updatedAt: Date.now(),
  };
};

const imageStateFromDataUrl = (dataUrl: string, fileName: string, width: number, height: number): ImageState => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return {
    fileName,
    mimeType: match?.[1] || 'image/png',
    base64: match?.[2] || null,
    width,
    height,
  };
};

const dataUrlFromImage = (image: ImageState) =>
  image.base64 && image.mimeType ? `data:${image.mimeType};base64,${image.base64}` : null;

const fieldLabel = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());

const NumberField: React.FC<{
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min = -10, max = 10, step = 0.1, onChange }) => (
  <label className="space-y-1.5">
    <div className="flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
      <span>{label}</span>
      <span className="font-mono text-[var(--color-text)]">{Number(value).toFixed(step < 1 ? 1 : 0)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full"
    />
  </label>
);

const createGeometry = (object: VirtualSetObject): THREE.BufferGeometry => {
  if (object.type === 'sphere') return new THREE.SphereGeometry(0.75, 48, 32);
  if (object.type === 'cylinder') return new THREE.CylinderGeometry(0.65, 0.65, 1.3, 48);
  if (object.type === 'wall') return new THREE.BoxGeometry(4.5, 2.8, 0.12);
  if (object.type === 'platform') return new THREE.BoxGeometry(4.8, 0.18, 3.6);
  if (object.type === 'backdrop') return new THREE.BoxGeometry(4.6, 3.2, 0.1);
  if (object.type === 'plane' || object.type === 'image-plane') return new THREE.PlaneGeometry(3.2, 2.1);
  return new THREE.BoxGeometry(1.35, 1.35, 1.35);
};

const applyTransform = (target: THREE.Object3D, transform: VirtualSetTransform) => {
  target.position.set(transform.x, transform.y, transform.z);
  target.rotation.set(
    THREE.MathUtils.degToRad(transform.rotationX),
    THREE.MathUtils.degToRad(transform.rotationY),
    THREE.MathUtils.degToRad(transform.rotationZ),
  );
  target.scale.set(transform.scaleX, transform.scaleY, transform.scaleZ);
};

const extractTransform = (target: THREE.Object3D): VirtualSetTransform => ({
  x: Number(target.position.x.toFixed(3)),
  y: Number(target.position.y.toFixed(3)),
  z: Number(target.position.z.toFixed(3)),
  rotationX: Number(THREE.MathUtils.radToDeg(target.rotation.x).toFixed(2)),
  rotationY: Number(THREE.MathUtils.radToDeg(target.rotation.y).toFixed(2)),
  rotationZ: Number(THREE.MathUtils.radToDeg(target.rotation.z).toFixed(2)),
  scaleX: Number(target.scale.x.toFixed(3)),
  scaleY: Number(target.scale.y.toFixed(3)),
  scaleZ: Number(target.scale.z.toFixed(3)),
});

const VirtualSetViewport = forwardRef<VirtualSetViewportHandle, {
  sceneData: VirtualSetScene;
  selectedObjectId: string | null;
  transformMode: TransformMode;
  onSelectObject: (id: string | null) => void;
  onObjectTransform: (id: string, transform: VirtualSetTransform) => void;
  onViewportError?: (message: string | null) => void;
}>(({ sceneData, selectedObjectId, transformMode, onSelectObject, onObjectTransform, onViewportError }, ref) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const objectMapRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const onSelectObjectRef = useRef(onSelectObject);
  const onObjectTransformRef = useRef(onObjectTransform);

  useEffect(() => {
    onSelectObjectRef.current = onSelectObject;
    onObjectTransformRef.current = onObjectTransform;
  }, [onObjectTransform, onSelectObject]);

  const resize = useCallback(() => {
    const host = hostRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!host || !renderer || !camera) return;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }, []);

  useImperativeHandle(ref, () => ({
    capture: (format, width, height) => {
      const renderer = rendererRef.current;
      const threeScene = sceneRef.current;
      const camera = cameraRef.current;
      if (!renderer || !threeScene || !camera) return null;
      const host = hostRef.current;
      const rect = host?.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(threeScene, camera);
      const dataUrl = renderer.domElement.toDataURL(`image/${format}`, format === 'jpeg' ? 0.92 : undefined);
      if (rect) {
        renderer.setSize(rect.width, rect.height, false);
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
      }
      return dataUrl;
    },
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    try {
      const threeScene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
      renderer.setClearColor('#0b0d10', 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.className = 'h-full w-full';
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 1, 0);

      const transformControls = new TransformControls(camera, renderer.domElement);
      transformControls.setSize(0.86);
      transformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
      });
      transformControls.addEventListener('mouseUp', () => {
        const controlledObject = transformControls.object;
        const objectId = controlledObject?.userData.virtualSetId as string | undefined;
        if (controlledObject && objectId) {
          onObjectTransformRef.current(objectId, extractTransform(controlledObject));
        }
      });

      sceneRef.current = threeScene;
      cameraRef.current = camera;
      rendererRef.current = renderer;
      controlsRef.current = controls;
      transformControlsRef.current = transformControls;
      onViewportError?.(null);

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const handlePointerDown = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(Array.from(objectMapRef.current.values()), true);
        const hitId = hits.find((hit) => typeof hit.object.userData.virtualSetId === 'string')?.object.userData.virtualSetId as string | undefined;
        if (hitId) {
          onSelectObjectRef.current(hitId);
        } else if (hits.length === 0) {
          onSelectObjectRef.current(null);
        }
      };
      renderer.domElement.addEventListener('pointerdown', handlePointerDown);

      let animationFrame = 0;
      const animate = () => {
        controls.update();
        renderer.render(threeScene, camera);
        animationFrame = window.requestAnimationFrame(animate);
      };
      animate();

      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      return () => {
        window.cancelAnimationFrame(animationFrame);
        observer.disconnect();
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
        controls.dispose();
        transformControls.dispose();
        renderer.dispose();
        if (host.contains(renderer.domElement)) {
          host.removeChild(renderer.domElement);
        }
        sceneRef.current = null;
        rendererRef.current = null;
        cameraRef.current = null;
        controlsRef.current = null;
        transformControlsRef.current = null;
        objectMapRef.current.clear();
      };
    } catch (setupError) {
      onViewportError?.(setupError instanceof Error ? setupError.message : 'The 3D preview could not start.');
      return undefined;
    }
  }, [onViewportError, resize]);

  useEffect(() => {
    const threeScene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    if (!threeScene || !camera || !controls || !renderer) return;

    objectMapRef.current.clear();
    while (threeScene.children.length > 0) {
      const child = threeScene.children[0];
      threeScene.remove(child);
    }

    const sky = skyOptions.find((item) => item.id === sceneData.lighting.skyPreset) || skyOptions[0];
    threeScene.background = new THREE.Color(sky.background);
    renderer.setClearColor(sky.background, 1);
    threeScene.fog = new THREE.FogExp2(sky.background, sceneData.lighting.fog * 0.035);

    const ambient = new THREE.HemisphereLight(sky.ambient, '#1f2937', 0.65 + sceneData.lighting.fillIntensity);
    threeScene.add(ambient);

    const sun = new THREE.DirectionalLight('#fff5df', sceneData.lighting.sunIntensity * 2.4);
    const sunRadians = THREE.MathUtils.degToRad(sceneData.lighting.sunAngle);
    sun.position.set(Math.cos(sunRadians) * 5, 6, Math.sin(sunRadians) * 5);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    threeScene.add(sun);

    const rim = new THREE.DirectionalLight('#dbeafe', sceneData.lighting.rimIntensity * 1.8);
    rim.position.set(-4, 3, 5);
    threeScene.add(rim);

    const grid = new THREE.GridHelper(12, 24, '#3b4148', '#22272d');
    grid.position.y = -0.22;
    threeScene.add(grid);

    sceneData.objects.filter((object) => object.visible).forEach((object) => {
      const textureUrl = object.type === 'image-plane' && object.image ? dataUrlFromImage(object.image) : null;
      const material = new THREE.MeshStandardMaterial({
        color: object.color,
        roughness: object.roughness,
        metalness: object.metallic,
        side: THREE.DoubleSide,
      });
      if (textureUrl) {
        material.map = new THREE.TextureLoader().load(textureUrl);
        material.color = new THREE.Color('#ffffff');
      }

      const mesh = new THREE.Mesh(createGeometry(object), material);
      mesh.castShadow = object.type !== 'platform' && object.type !== 'backdrop' && object.type !== 'wall';
      mesh.receiveShadow = true;
      mesh.userData.virtualSetId = object.id;
      applyTransform(mesh, object.transform);
      if (object.type === 'plane' || object.type === 'image-plane') {
        mesh.rotation.y += 0;
      }
      threeScene.add(mesh);
      objectMapRef.current.set(object.id, mesh);

      if (object.id === selectedObjectId) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(createGeometry(object)),
          new THREE.LineBasicMaterial({ color: '#a7f83b', linewidth: 2 }),
        );
        edges.userData.virtualSetId = object.id;
        applyTransform(edges, object.transform);
        threeScene.add(edges);
      }
    });

    const transformControls = transformControlsRef.current;
    if (transformControls) {
      transformControls.setMode(transformMode);
      const transformHelper = transformControls.getHelper();
      if (!threeScene.children.includes(transformHelper)) {
        threeScene.add(transformHelper);
      }
      const selectedMesh = selectedObjectId ? objectMapRef.current.get(selectedObjectId) : null;
      if (selectedMesh) {
        transformControls.attach(selectedMesh);
      } else {
        transformControls.detach();
      }
    }

    camera.fov = Math.max(22, Math.min(70, 58 - (sceneData.camera.focalLength - 24) * 0.42));
    camera.position.set(sceneData.camera.x, sceneData.camera.y, sceneData.camera.z);
    controls.target.set(sceneData.camera.targetX, sceneData.camera.targetY, sceneData.camera.targetZ);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    renderer.render(threeScene, camera);
  }, [sceneData, selectedObjectId, transformMode]);

  return <div ref={hostRef} className="h-full min-h-[420px] w-full overflow-hidden bg-[#0b0d10]" />;
});

VirtualSetViewport.displayName = 'VirtualSetViewport';

export const VirtualSetView: React.FC<VirtualSetViewProps> = ({
  project,
  onUpdateProject,
  onCreateProject,
  canCreateProjects,
  onUseRender,
}) => {
  const [scene, setScene] = useState<VirtualSetScene>(() => createScene());
  const [status, setStatus] = useState<VirtualSetStatus | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewportError, setViewportError] = useState<string | null>(null);
  const [renderFormat, setRenderFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [renderSize, setRenderSize] = useState(renderSizes[3]);
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const viewportRef = useRef<VirtualSetViewportHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasLoadedProjectRef = useRef(false);

  const selectedObject = useMemo(
    () => scene.objects.find((object) => object.id === scene.selectedObjectId) || null,
    [scene.objects, scene.selectedObjectId],
  );

  const saveSceneToProject = useCallback((targetProject: Project, nextScene: VirtualSetScene) => {
    const virtualSet = {
      ...(targetProject.state?.virtualSet || {}),
      activeSceneId: nextScene.id,
      scenes: [nextScene],
      lastRuntimeStatus: status,
    };
    onUpdateProject({
      ...targetProject,
      lastModified: Date.now(),
      state: {
        ...(targetProject.state || {}),
        virtualSet,
      },
    });
  }, [onUpdateProject, status]);

  useEffect(() => {
    const projectScene = project?.state?.virtualSet?.scenes?.[0] as VirtualSetScene | undefined;
    if (projectScene) {
      setScene(projectScene);
      hasLoadedProjectRef.current = true;
    } else if (!project) {
      setScene(createScene());
      hasLoadedProjectRef.current = true;
    }
  }, [project?.id]);

  useEffect(() => {
    if (!project || !hasLoadedProjectRef.current) return;
    const timer = window.setTimeout(() => saveSceneToProject(project, scene), 650);
    return () => window.clearTimeout(timer);
  }, [project, saveSceneToProject, scene]);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getVirtualSetStatus());
    } catch (statusError) {
      console.warn('Could not refresh Virtual Set status.', statusError);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 2500);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const updateScene = useCallback((updater: (current: VirtualSetScene) => VirtualSetScene) => {
    setScene((current) => {
      const next = { ...updater(current), updatedAt: Date.now() };
      if (status?.state === 'running') {
        sendVirtualSetCommand({ type: 'scene.update', scene: next }).catch(() => undefined);
      }
      return next;
    });
  }, [status?.state]);

  const ensureProject = useCallback(async (nextScene: VirtualSetScene): Promise<Project | null> => {
    if (project) return project;
    if (!onCreateProject || !canCreateProjects) {
      setError('Project storage is not available. Restart ISTUDIO with LAUNCH.bat.');
      return null;
    }
    return await onCreateProject('Virtual Set Session', {
      virtualSet: {
        activeSceneId: nextScene.id,
        scenes: [nextScene],
      },
    });
  }, [canCreateProjects, onCreateProject, project]);

  const handleStartRuntime = useCallback(async () => {
    setError(null);
    const activeProject = await ensureProject(scene);
    try {
      setStatus(await startVirtualSetRuntime(activeProject?.id || null));
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Could not start Virtual Set runtime.');
    }
  }, [ensureProject, scene]);

  const handleStopRuntime = useCallback(async () => {
    try {
      setStatus(await stopVirtualSetRuntime());
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Could not stop Virtual Set runtime.');
    }
  }, []);

  const handlePreset = (preset: VirtualSetPreset) => {
    const next = createScene(preset);
    next.renders = scene.renders;
    updateScene(() => next);
  };

  const addObject = (type: VirtualSetObjectType, image?: ImageState | null) => {
    updateScene((current) => {
      const object = createObject(type, current.objects.length + 1, image);
      object.transform.x = (current.objects.length % 4) - 1.5;
      object.transform.y = type === 'image-plane' ? 1.4 : object.transform.y;
      return {
        ...current,
        selectedObjectId: object.id,
        objects: [...current.objects, object],
      };
    });
  };

  const updateSelectedObject = (updater: (object: VirtualSetObject) => VirtualSetObject) => {
    if (!selectedObject) return;
    updateScene((current) => ({
      ...current,
      objects: current.objects.map((object) => object.id === selectedObject.id ? updater(object) : object),
    }));
  };

  const commitViewportTransform = useCallback((id: string, transform: VirtualSetTransform) => {
    updateScene((current) => ({
      ...current,
      objects: current.objects.map((object) => object.id === id ? { ...object, transform } : object),
    }));
  }, [updateScene]);

  const duplicateSelected = () => {
    if (!selectedObject) return;
    const copy: VirtualSetObject = {
      ...selectedObject,
      id: `${selectedObject.type}-${Date.now()}`,
      name: `${selectedObject.name} copy`,
      locked: false,
      transform: {
        ...selectedObject.transform,
        x: selectedObject.transform.x + 0.55,
        z: selectedObject.transform.z + 0.35,
      },
    };
    updateScene((current) => ({
      ...current,
      selectedObjectId: copy.id,
      objects: [...current.objects, copy],
    }));
  };

  const deleteSelected = () => {
    if (!selectedObject) return;
    updateScene((current) => ({
      ...current,
      selectedObjectId: null,
      objects: current.objects.filter((object) => object.id !== selectedObject.id),
    }));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      if (event.key.toLowerCase() === 'w') setTransformMode('translate');
      if (event.key.toLowerCase() === 'e') setTransformMode('rotate');
      if (event.key.toLowerCase() === 'r') setTransformMode('scale');
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedObject) {
        event.preventDefault();
        deleteSelected();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selectedObject) {
        event.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObject, scene.objects]);

  const handleImageImport = async (file: File | null) => {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read image asset.'));
      reader.readAsDataURL(file);
    });
    const image = imageStateFromDataUrl(dataUrl, file.name, 0, 0);
    addObject('image-plane', image);
  };

  const handleRender = async () => {
    setError(null);
    setIsRendering(true);
    try {
      const activeProject = await ensureProject(scene);
      if (!activeProject) return;
      const dataUrl = viewportRef.current?.capture(renderFormat, renderSize.width, renderSize.height);
      if (!dataUrl) throw new Error('Could not capture the virtual set.');

      const result = await saveVirtualSetRender({
        projectId: activeProject.id,
        scene,
        dataUrl,
        name: `${scene.name} ${new Date().toISOString().replace(/[:.]/g, '-')}`,
        width: renderSize.width,
        height: renderSize.height,
        format: renderFormat,
      });

      const render: VirtualSetRender = {
        id: result.id,
        name: result.name,
        dataUrl: result.dataUrl,
        mimeType: result.mimeType,
        width: result.width || renderSize.width,
        height: result.height || renderSize.height,
        createdAt: result.createdAt,
      };
      const nextScene = { ...scene, renders: [render, ...scene.renders].slice(0, 48), updatedAt: Date.now() };
      setScene(nextScene);
      saveSceneToProject(activeProject, nextScene);
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : 'Virtual Set render failed.');
    } finally {
      setIsRendering(false);
    }
  };

  const useRender = (render: VirtualSetRender, mode: 'reference' | 'background') => {
    onUseRender(
      imageStateFromDataUrl(render.dataUrl, `${render.name}.${render.mimeType.includes('jpeg') ? 'jpg' : render.mimeType.split('/').pop() || 'png'}`, render.width, render.height),
      mode,
    );
  };

  const runtimeMessage = status?.message || 'Checking Virtual Set runtime.';
  const showUnrealViewport = status?.state === 'running' && status.streamUrl;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#07080A]">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col gap-4 border-b border-white/10 bg-[#0d0f12] p-4 lg:w-[296px] lg:border-b-0 lg:border-r">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--color-accent)]">Virtual Set Studio</p>
            <h1 className="mt-2 text-2xl font-black text-[var(--color-text)]">Build a 3D reference set.</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
              Compose a virtual environment, render a still, then use it as reference DNA or a background source.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-[var(--color-text)]">Unreal Runtime</p>
                <p className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">{runtimeMessage}</p>
              </div>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${status?.state === 'running' ? 'bg-[var(--color-accent)]' : status?.runtimeAvailable ? 'bg-amber-400' : 'bg-zinc-500'}`} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={handleStartRuntime} className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-xs">
                <PlayIcon className="h-3.5 w-3.5" />
                Start
              </button>
              <button type="button" onClick={handleStopRuntime} className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-xs">
                <StopCircleIcon className="h-3.5 w-3.5" />
                Stop
              </button>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="text-xs font-black uppercase tracking-[0.16em] text-[var(--color-text-muted)]">Scene Presets</h2>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePreset(preset.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${scene.preset === preset.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-white/10 bg-white/[0.035] hover:bg-white/[0.06]'}`}
                >
                  <span className="block h-4 w-8 rounded-full" style={{ background: preset.color }} />
                  <span className="mt-2 block text-xs font-extrabold text-[var(--color-text)]">{preset.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-black uppercase tracking-[0.16em] text-[var(--color-text-muted)]">Add Objects</h2>
            <div className="grid grid-cols-2 gap-2">
              {objectTools.map((tool) => (
                <button key={tool.type} type="button" onClick={() => addObject(tool.type)} className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-xs">
                  {tool.icon}
                  {tool.label}
                </button>
              ))}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-secondary col-span-2 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs">
                <ImageIcon className="h-3.5 w-3.5" />
                Add Image Plane
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleImageImport(event.target.files?.[0] || null)} />
            </div>
          </section>
        </aside>

        <main className="relative min-h-[500px] flex-1 overflow-hidden">
          <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs font-extrabold text-white backdrop-blur">
              {showUnrealViewport ? 'Live Unreal Viewport' : 'In-App 3D Preview'}
            </span>
            <span className="rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs text-[var(--color-text-muted)] backdrop-blur">
              {scene.width} x {scene.height}
            </span>
          </div>
          {!showUnrealViewport && (
            <div className="absolute left-4 top-16 z-20 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/55 p-2 backdrop-blur">
              {[
                ['translate', 'Move', 'W'],
                ['rotate', 'Rotate', 'E'],
                ['scale', 'Scale', 'R'],
              ].map(([mode, label, shortcut]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTransformMode(mode as TransformMode)}
                  className={`rounded-lg px-3 py-2 text-xs font-extrabold ${transformMode === mode ? 'bg-[var(--color-accent)] text-black' : 'bg-white/[0.075] text-white hover:bg-white/[0.12]'}`}
                >
                  {label}
                  <span className="ml-2 rounded bg-black/20 px-1.5 py-0.5 text-[10px]">{shortcut}</span>
                </button>
              ))}
            </div>
          )}
          {showUnrealViewport ? (
            <iframe title="ISTUDIO Unreal Virtual Set viewport" src={status.streamUrl!} className="h-full min-h-[500px] w-full border-0 bg-black" />
          ) : (
            <VirtualSetViewport
              ref={viewportRef}
              sceneData={scene}
              selectedObjectId={scene.selectedObjectId}
              transformMode={transformMode}
              onSelectObject={(id) => updateScene((current) => ({ ...current, selectedObjectId: id }))}
              onObjectTransform={commitViewportTransform}
              onViewportError={setViewportError}
            />
          )}
          {viewportError && !showUnrealViewport && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0b0d10] p-6">
              <div className="max-w-md rounded-2xl border border-amber-400/25 bg-amber-400/10 p-5 text-center shadow-2xl backdrop-blur">
                <p className="text-sm font-black text-amber-100">3D preview could not start</p>
                <p className="mt-2 text-sm leading-6 text-amber-100/80">
                  ISTUDIO could not initialize WebGL on this computer. Update the graphics driver or enable hardware acceleration, then reopen the app.
                </p>
                <p className="mt-3 break-words rounded-lg bg-black/25 p-2 text-xs text-amber-100/70">{viewportError}</p>
              </div>
            </div>
          )}
          {error && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="absolute bottom-4 left-4 right-4 z-30 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 backdrop-blur">
              {error}
            </motion.div>
          )}
        </main>

        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-white/10 bg-[#0d0f12] p-4 custom-scrollbar lg:w-[360px] lg:border-l lg:border-t-0">
          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-[var(--color-text)]">Object Inspector</h2>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{selectedObject ? selectedObject.name : 'Select an object in the viewport.'}</p>
              </div>
              <PaletteIcon className="h-4 w-4 text-[var(--color-accent)]" />
            </div>

            {selectedObject ? (
              <div className="space-y-4">
                <input
                  type="text"
                  value={selectedObject.name}
                  onChange={(event) => updateSelectedObject((object) => ({ ...object, name: event.target.value }))}
                  className="w-full px-3 py-2 text-sm"
                />
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={duplicateSelected} className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-xs">
                    <CopyIcon className="h-3.5 w-3.5" />
                    Copy
                  </button>
                  <button type="button" onClick={() => updateSelectedObject((object) => ({ ...object, visible: !object.visible }))} className="btn-secondary px-3 py-2 text-xs">
                    {selectedObject.visible ? 'Hide' : 'Show'}
                  </button>
                  <button type="button" onClick={deleteSelected} className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-xs text-red-300">
                    <Trash2Icon className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>

                <div className="space-y-3">
                  {(['x', 'y', 'z'] as const).map((key) => (
                    <NumberField key={key} label={fieldLabel(key)} value={selectedObject.transform[key]} min={-6} max={6} step={0.05} onChange={(value) => updateSelectedObject((object) => ({ ...object, transform: { ...object.transform, [key]: value } }))} />
                  ))}
                  {(['rotationX', 'rotationY', 'rotationZ'] as const).map((key) => (
                    <NumberField key={key} label={fieldLabel(key)} value={selectedObject.transform[key]} min={-180} max={180} step={1} onChange={(value) => updateSelectedObject((object) => ({ ...object, transform: { ...object.transform, [key]: value } }))} />
                  ))}
                  {(['scaleX', 'scaleY', 'scaleZ'] as const).map((key) => (
                    <NumberField key={key} label={fieldLabel(key)} value={selectedObject.transform[key]} min={0.1} max={4} step={0.05} onChange={(value) => updateSelectedObject((object) => ({ ...object, transform: { ...object.transform, [key]: value } }))} />
                  ))}
                </div>

                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <label className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Material Color</label>
                  <input type="color" value={selectedObject.color} onChange={(event) => updateSelectedObject((object) => ({ ...object, color: event.target.value }))} className="h-9 w-14 rounded-lg border border-white/10 bg-transparent p-1" />
                </div>
                <NumberField label="Roughness" value={selectedObject.roughness} min={0} max={1} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, roughness: value }))} />
                <NumberField label="Metallic" value={selectedObject.metallic} min={0} max={1} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, metallic: value }))} />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/10 p-5 text-center text-sm text-[var(--color-text-muted)]">
                Click a 3D object or choose one from the layer stack.
              </div>
            )}
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-4 flex items-center gap-2">
              <SunIcon className="h-4 w-4 text-[var(--color-accent)]" />
              <h2 className="text-sm font-black text-[var(--color-text)]">Sky & Lighting</h2>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {skyOptions.map((sky) => (
                <button key={sky.id} type="button" onClick={() => updateScene((current) => ({ ...current, lighting: { ...current.lighting, skyPreset: sky.id } }))} className={`rounded-lg border p-2 text-[10px] font-bold ${scene.lighting.skyPreset === sky.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-white/10 bg-white/[0.035]'}`}>
                  <span className="mb-1 block h-4 rounded" style={{ background: sky.background }} />
                  {sky.label}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-3">
              <NumberField label="Time Of Day" value={scene.lighting.timeOfDay} min={0} max={24} step={0.25} onChange={(value) => updateScene((current) => ({ ...current, lighting: { ...current.lighting, timeOfDay: value } }))} />
              <NumberField label="Sun Angle" value={scene.lighting.sunAngle} min={-180} max={180} step={1} onChange={(value) => updateScene((current) => ({ ...current, lighting: { ...current.lighting, sunAngle: value } }))} />
              <NumberField label="Sun Intensity" value={scene.lighting.sunIntensity} min={0} max={3} step={0.05} onChange={(value) => updateScene((current) => ({ ...current, lighting: { ...current.lighting, sunIntensity: value } }))} />
              <NumberField label="Fill Light" value={scene.lighting.fillIntensity} min={0} max={2} step={0.05} onChange={(value) => updateScene((current) => ({ ...current, lighting: { ...current.lighting, fillIntensity: value } }))} />
              <NumberField label="Rim Light" value={scene.lighting.rimIntensity} min={0} max={2} step={0.05} onChange={(value) => updateScene((current) => ({ ...current, lighting: { ...current.lighting, rimIntensity: value } }))} />
              <NumberField label="Fog" value={scene.lighting.fog} min={0} max={1} step={0.01} onChange={(value) => updateScene((current) => ({ ...current, lighting: { ...current.lighting, fog: value } }))} />
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-4 flex items-center gap-2">
              <CameraIcon className="h-4 w-4 text-[var(--color-accent)]" />
              <h2 className="text-sm font-black text-[var(--color-text)]">Camera & Render</h2>
            </div>
            <div className="space-y-3">
              <NumberField label="Focal Length" value={scene.camera.focalLength} min={18} max={85} step={1} onChange={(value) => updateScene((current) => ({ ...current, camera: { ...current.camera, focalLength: value } }))} />
              <div className="grid grid-cols-4 gap-2">
                {renderSizes.map((size) => (
                  <button key={size.label} type="button" onClick={() => setRenderSize(size)} className={`rounded-lg border px-3 py-2 text-xs font-extrabold ${renderSize.label === size.label ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-white/10 bg-white/[0.035] text-[var(--color-text-muted)]'}`}>
                    {size.label}
                  </button>
                ))}
              </div>
              <select value={renderFormat} onChange={(event) => setRenderFormat(event.target.value as 'png' | 'jpeg' | 'webp')} className="w-full px-3 py-2 text-sm">
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
              <button type="button" onClick={handleRender} disabled={isRendering} className="primary-cta flex w-full items-center justify-center gap-2 px-4 py-3 text-sm disabled:opacity-50">
                {isRendering ? <SparklesIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
                Render Background
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-black text-[var(--color-text)]">Layers</h2>
              <span className="text-xs text-[var(--color-text-muted)]">{scene.objects.length}</span>
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {scene.objects.map((object) => (
                <button key={object.id} type="button" onClick={() => updateScene((current) => ({ ...current, selectedObjectId: object.id }))} className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left ${scene.selectedObjectId === object.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-white/10 bg-white/[0.035]'}`}>
                  <span className="min-w-0 truncate text-xs font-extrabold text-[var(--color-text)]">{object.name}</span>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: object.color }} />
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-black text-[var(--color-text)]">Render History</h2>
              <span className="text-xs text-[var(--color-text-muted)]">{scene.renders.length}</span>
            </div>
            <div className="space-y-3">
              {scene.renders.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-[var(--color-text-muted)]">
                  Render a still to save it into the project and send it into Reference Edit.
                </p>
              ) : scene.renders.slice(0, 6).map((render) => (
                <div key={render.id} className="overflow-hidden rounded-lg border border-white/10 bg-black/25">
                  <img src={render.dataUrl} alt={render.name} className="aspect-video w-full object-cover" />
                  <div className="space-y-2 p-3">
                    <p className="truncate text-xs font-extrabold text-[var(--color-text)]">{render.name}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => useRender(render, 'reference')} className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-xs">
                        <SendIcon className="h-3.5 w-3.5" />
                        Reference
                      </button>
                      <button type="button" onClick={() => useRender(render, 'background')} className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-xs">
                        <DownloadIcon className="h-3.5 w-3.5" />
                        Background
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};
