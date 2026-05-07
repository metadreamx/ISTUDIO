import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  BoxIcon,
  CameraIcon,
  CircleIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FocusIcon,
  Grid3X3Icon,
  LayersIcon,
  LightbulbIcon,
  LockIcon,
  Move3DIcon,
  PaletteIcon,
  Redo2Icon,
  Rotate3DIcon,
  SaveIcon,
  ScalingIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
  Trash2Icon,
  UnlockIcon,
  UploadIcon,
  ZapIcon,
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import {
  BloomEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SSAOEffect,
  VignetteEffect,
} from 'postprocessing';
import {
  PhysicalSpotLight,
  ShapedAreaLight,
} from 'three-gpu-pathtracer';
import type {
  ImageState,
  Project,
  VirtualSetAsset,
  VirtualSetCamera,
  VirtualSetEnvironment,
  VirtualSetLight,
  VirtualSetLightType,
  VirtualSetMaterial,
  VirtualSetMaterialPreset,
  VirtualSetObject,
  VirtualSetObjectType,
  VirtualSetPreviewQuality,
  VirtualSetRender,
  VirtualSetRenderState,
  VirtualSetRendererSettings,
  VirtualSetScene,
  VirtualSetSkyPreset,
  VirtualSetTransform,
} from '../types';
import { saveVirtualSetRender } from '../services/db';

interface VirtualSetViewProps {
  project: Project | null;
  onUpdateProject: (project: Project) => void;
  onCreateProject?: (name: string, initialState?: Project['state']) => Promise<Project | null>;
  canCreateProjects: boolean;
  onUseRender: (image: ImageState, mode: 'reference' | 'background') => void;
}

type TransformMode = 'translate' | 'rotate' | 'scale';
type RenderFormat = 'png' | 'jpeg' | 'webp';
type RenderMode = 'preview' | 'beauty';
type InspectorTab = 'objects' | 'lights' | 'world' | 'render';
type TextureSlot = 'textureAssetId' | 'normalAssetId' | 'roughnessAssetId' | 'metalnessAssetId';
type AssetTab = 'models' | 'props' | 'backdrops' | 'lights' | 'materials' | 'hdris';

interface CaptureOptions {
  format: RenderFormat;
  width: number;
  height: number;
  mode: RenderMode;
  samples: number;
  bounces: number;
  filterGlossyFactor: number;
  onProgress?: (progress: number, state: VirtualSetRenderState) => void;
  isCanceled?: () => boolean;
}

interface VirtualSetViewportHandle {
  capture: (options: CaptureOptions) => Promise<string | null>;
  focusObject: (id: string | null) => void;
}

interface ThreeRuntime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  transform: TransformControls;
  transformHelper: THREE.Object3D;
  root: THREE.Group;
  helpers: THREE.Group;
  pmrem: THREE.PMREMGenerator;
  composer: EffectComposer | null;
  canvas: HTMLCanvasElement;
}

interface LiveLightBinding {
  handle: THREE.Object3D;
  actual: THREE.Object3D | null;
  panel: THREE.Object3D | null;
  target: THREE.Object3D | null;
  type: VirtualSetLightType;
  baseWidth: number;
  baseHeight: number;
}

const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;

const skyOptions: { id: VirtualSetSkyPreset; label: string; top: string; bottom: string }[] = [
  { id: 'clear', label: 'Clear', top: '#a8c7ed', bottom: '#eef6ff' },
  { id: 'cloudy', label: 'Cloudy', top: '#8f9ba8', bottom: '#d8dde5' },
  { id: 'sunset', label: 'Sunset', top: '#e4865b', bottom: '#33204a' },
  { id: 'night', label: 'Night', top: '#090d18', bottom: '#1f2a44' },
  { id: 'hdri', label: 'Studio HDR', top: '#5c6876', bottom: '#d6dde8' },
];

const materialPresets: Record<VirtualSetMaterialPreset, Omit<VirtualSetMaterial, 'preset'>> = {
  'matte-paper': {
    color: '#f1f3f0',
    roughness: 0.82,
    metallic: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.45,
    transmission: 0,
    opacity: 1,
    emissive: '#000000',
    emissiveIntensity: 0,
    reflectionIntensity: 0.18,
    specularIntensity: 0.45,
    ior: 1.45,
    thickness: 0,
    normalStrength: 1,
  },
  'studio-floor': {
    color: '#d9dee5',
    roughness: 0.34,
    metallic: 0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.18,
    transmission: 0,
    opacity: 1,
    emissive: '#000000',
    emissiveIntensity: 0,
    reflectionIntensity: 0.64,
    specularIntensity: 0.8,
    ior: 1.48,
    thickness: 0,
    normalStrength: 0.85,
  },
  concrete: {
    color: '#77716a',
    roughness: 0.72,
    metallic: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.65,
    transmission: 0,
    opacity: 1,
    emissive: '#000000',
    emissiveIntensity: 0,
    reflectionIntensity: 0.24,
    specularIntensity: 0.5,
    ior: 1.45,
    thickness: 0,
    normalStrength: 1,
  },
  fabric: {
    color: '#756996',
    roughness: 0.92,
    metallic: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.8,
    transmission: 0,
    opacity: 1,
    emissive: '#000000',
    emissiveIntensity: 0,
    reflectionIntensity: 0.08,
    specularIntensity: 0.28,
    ior: 1.35,
    thickness: 0,
    normalStrength: 1.25,
  },
  'glossy-acrylic': {
    color: '#dbe9ff',
    roughness: 0.12,
    metallic: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.05,
    transmission: 0.12,
    opacity: 0.82,
    emissive: '#000000',
    emissiveIntensity: 0,
    reflectionIntensity: 1.25,
    specularIntensity: 1,
    ior: 1.49,
    thickness: 0.08,
    normalStrength: 0.4,
  },
  chrome: {
    color: '#f7f9fb',
    roughness: 0.08,
    metallic: 1,
    clearcoat: 0.55,
    clearcoatRoughness: 0.04,
    transmission: 0,
    opacity: 1,
    emissive: '#000000',
    emissiveIntensity: 0,
    reflectionIntensity: 1.8,
    specularIntensity: 1.2,
    ior: 1.9,
    thickness: 0,
    normalStrength: 0.25,
  },
  glass: {
    color: '#d8f4ff',
    roughness: 0.02,
    metallic: 0,
    clearcoat: 1,
    clearcoatRoughness: 0,
    transmission: 0.86,
    opacity: 0.38,
    emissive: '#000000',
    emissiveIntensity: 0,
    reflectionIntensity: 1.6,
    specularIntensity: 1.15,
    ior: 1.52,
    thickness: 0.32,
    normalStrength: 0.2,
  },
  'emissive-panel': {
    color: '#ffffff',
    roughness: 0.28,
    metallic: 0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.12,
    transmission: 0,
    opacity: 1,
    emissive: '#d7f7ff',
    emissiveIntensity: 3.6,
    reflectionIntensity: 0.45,
    specularIntensity: 0.75,
    ior: 1.45,
    thickness: 0,
    normalStrength: 0.5,
  },
};

const materialLabels: Record<VirtualSetMaterialPreset, string> = {
  'matte-paper': 'Matte Paper',
  'studio-floor': 'Studio Floor',
  concrete: 'Concrete',
  fabric: 'Fabric',
  'glossy-acrylic': 'Glossy Acrylic',
  chrome: 'Chrome',
  glass: 'Glass',
  'emissive-panel': 'Light Panel',
};

const objectTools: { type: VirtualSetObjectType; label: string; icon: React.ReactNode }[] = [
  { type: 'cube', label: 'Cube', icon: <BoxIcon className="h-4 w-4" /> },
  { type: 'sphere', label: 'Sphere', icon: <CircleIcon className="h-4 w-4" /> },
  { type: 'cylinder', label: 'Cylinder', icon: <CircleIcon className="h-4 w-4" /> },
  { type: 'wall', label: 'Wall', icon: <SquareIcon className="h-4 w-4" /> },
  { type: 'platform', label: 'Platform', icon: <LayersIcon className="h-4 w-4" /> },
  { type: 'backdrop', label: 'Backdrop', icon: <SquareIcon className="h-4 w-4" /> },
];

const lightTools: { id: string; type: VirtualSetLightType; label: string }[] = [
  { id: 'sun', type: 'directional', label: 'Sun' },
  { id: 'key', type: 'area', label: 'Key Light' },
  { id: 'fill', type: 'area', label: 'Fill Light' },
  { id: 'rim', type: 'spot', label: 'Rim Light' },
  { id: 'softbox', type: 'area', label: 'Softbox' },
  { id: 'spot', type: 'spot', label: 'Spot' },
  { id: 'practical', type: 'point', label: 'Practical' },
  { id: 'panel', type: 'panel', label: 'Panel' },
];

const cinematicLightingPresets = [
  { id: 'golden', label: 'Golden Studio', sky: 'hdri' as VirtualSetSkyPreset, ambient: 0.82, reflection: 1.18, exposure: 1.06 },
  { id: 'soft-day', label: 'Soft Daylight', sky: 'clear' as VirtualSetSkyPreset, ambient: 0.72, reflection: 1.05, exposure: 1 },
  { id: 'dramatic', label: 'Dramatic Rim', sky: 'sunset' as VirtualSetSkyPreset, ambient: 0.28, reflection: 0.95, exposure: 0.92 },
];

const renderSizes = [
  { label: '1:1', width: 1600, height: 1600 },
  { label: '4:5', width: 1600, height: 2000 },
  { label: '9:16', width: 1440, height: 2560 },
  { label: '16:9', width: 1920, height: 1080 },
];

const cameraPresets = [
  { id: 'wide', label: 'Wide', focalLength: 24, position: { x: 15, y: 8, z: 15 }, target: { x: 0, y: 0.4, z: 0 } },
  { id: 'portrait', label: 'Portrait', focalLength: 50, position: { x: 4.2, y: 2.5, z: 5.2 }, target: { x: 0, y: 1.1, z: 0 } },
  { id: 'product', label: 'Product', focalLength: 70, position: { x: 3.6, y: 2.2, z: 3.6 }, target: { x: 0, y: 0.75, z: 0 } },
  { id: 'cinematic', label: 'Cinematic', focalLength: 35, position: { x: 7.5, y: 2.4, z: 8.5 }, target: { x: 0, y: 0.7, z: 0 } },
  { id: 'top', label: 'Top Down', focalLength: 32, position: { x: 0.1, y: 15, z: 0.1 }, target: { x: 0, y: 0, z: 0 } },
  { id: 'close', label: 'Close Up', focalLength: 85, position: { x: 2.4, y: 1.8, z: 2.7 }, target: { x: 0, y: 0.8, z: 0 } },
];

const renderPresetCards = [
  {
    id: 'fast',
    label: 'Fast',
    description: 'Lightweight preview',
    settings: { samples: 24, bounces: 3, shadowQuality: 1024, ambientOcclusionIntensity: 0.35, bloomIntensity: 0.22, enableDepthOfField: false, enableBloom: true, enableSSAO: true, enableVignette: false, exposure: 0.96 },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Clean daily work',
    settings: { samples: 64, bounces: 5, shadowQuality: 2048, ambientOcclusionIntensity: 0.48, bloomIntensity: 0.32, enableDepthOfField: false, enableBloom: true, enableSSAO: true, enableVignette: true, exposure: 1 },
  },
  {
    id: 'ultra',
    label: 'Ultra',
    description: 'Best viewport look',
    settings: { samples: 128, bounces: 8, shadowQuality: 4096, ambientOcclusionIntensity: 0.55, bloomIntensity: 0.45, enableDepthOfField: false, enableBloom: true, enableSSAO: true, enableVignette: true, exposure: 1 },
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    description: 'Lens and mood',
    settings: { samples: 160, bounces: 8, shadowQuality: 4096, ambientOcclusionIntensity: 0.68, bloomIntensity: 0.52, depthOfFieldStrength: 1.25, enableDepthOfField: true, enableBloom: true, enableSSAO: true, enableVignette: true, vignetteStrength: 0.32, exposure: 0.92 },
  },
  {
    id: 'product',
    label: 'Product',
    description: 'Crisp reflections',
    settings: { samples: 160, bounces: 10, shadowQuality: 4096, ambientOcclusionIntensity: 0.5, bloomIntensity: 0.28, filterGlossyFactor: 0.42, enableDepthOfField: false, enableBloom: true, enableSSAO: true, enableVignette: false, exposure: 1.05 },
  },
  {
    id: 'social',
    label: 'Social',
    description: 'Vertical ready',
    size: '9:16',
    settings: { samples: 96, bounces: 6, shadowQuality: 2048, ambientOcclusionIntensity: 0.52, bloomIntensity: 0.5, enableDepthOfField: false, enableBloom: true, enableSSAO: true, enableVignette: true, exposure: 1.04 },
  },
] satisfies {
  id: string;
  label: string;
  description: string;
  size?: string;
  settings: Partial<VirtualSetRendererSettings>;
}[];

const assetTabs: { id: AssetTab; label: string }[] = [
  { id: 'models', label: 'Models' },
  { id: 'props', label: 'Props' },
  { id: 'backdrops', label: 'Backdrops' },
  { id: 'lights', label: 'Lights' },
  { id: 'materials', label: 'Materials' },
  { id: 'hdris', label: 'HDRIs' },
];

const qualityPixelRatio: Record<VirtualSetPreviewQuality, number> = {
  draft: 0.75,
  balanced: 1,
  ultra: Math.min(1.5, Math.max(1.25, window.devicePixelRatio || 1)),
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const hexToThree = (hex: string) => new THREE.Color(hex || '#ffffff');

const cloneScene = (scene: VirtualSetScene): VirtualSetScene => {
  if (typeof structuredClone === 'function') return structuredClone(scene);
  return JSON.parse(JSON.stringify(scene)) as VirtualSetScene;
};

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

const materialFromPreset = (preset: VirtualSetMaterialPreset, overrides: Partial<VirtualSetMaterial> = {}): VirtualSetMaterial => ({
  preset,
  ...materialPresets[preset],
  textureAssetId: null,
  normalAssetId: null,
  roughnessAssetId: null,
  metalnessAssetId: null,
  ...overrides,
});

const normalizeMaterial = (material: Partial<VirtualSetMaterial> | undefined, fallback: VirtualSetMaterialPreset): VirtualSetMaterial => ({
  ...materialFromPreset(fallback),
  ...(material || {}),
  reflectionIntensity: material?.reflectionIntensity ?? materialPresets[fallback].reflectionIntensity,
  specularIntensity: material?.specularIntensity ?? materialPresets[fallback].specularIntensity,
  clearcoatRoughness: material?.clearcoatRoughness ?? material?.roughness ?? materialPresets[fallback].clearcoatRoughness,
  ior: material?.ior ?? materialPresets[fallback].ior,
  thickness: material?.thickness ?? materialPresets[fallback].thickness,
  normalStrength: material?.normalStrength ?? materialPresets[fallback].normalStrength,
});

const defaultCamera = (): VirtualSetCamera => ({
  focalLength: 32,
  aperture: 5.6,
  focusDistance: 12,
  moveSpeed: 4,
  x: 13,
  y: 8,
  z: 13,
  targetX: 0,
  targetY: 0.4,
  targetZ: 0,
});

const defaultEnvironment = (skyPreset: VirtualSetSkyPreset = 'hdri'): VirtualSetEnvironment => {
  const sky = skyOptions.find((item) => item.id === skyPreset) || skyOptions[0];
  return {
    skyPreset,
    backgroundTop: sky.top,
    backgroundBottom: sky.bottom,
    ambientIntensity: 0.78,
    reflectionIntensity: 1.12,
    showBackground: true,
    fog: 0.012,
    fogColor: sky.bottom,
    hdriAssetId: null,
  };
};

const defaultRendererSettings = (): VirtualSetRendererSettings => ({
  previewQuality: 'ultra',
  renderState: 'preview',
  samples: 128,
  bounces: 8,
  filterGlossyFactor: 0.55,
  exposure: 1,
  enableSSAO: true,
  ambientOcclusionIntensity: 0.55,
  enableBloom: true,
  bloomIntensity: 0.45,
  bloomThreshold: 0.8,
  enableDepthOfField: false,
  depthOfFieldStrength: 0.9,
  enableVignette: true,
  vignetteStrength: 0.22,
  shadowQuality: 4096,
});

const defaultLighting = (skyPreset: VirtualSetSkyPreset = 'hdri') => ({
  skyPreset,
  timeOfDay: 14,
  sunAngle: 38,
  sunIntensity: 1.1,
  fillIntensity: 0.35,
  rimIntensity: 0.25,
  colorTemperature: 5600,
  fog: 0.04,
});

const createLight = (type: VirtualSetLightType, index = 1, overrides: Partial<VirtualSetLight> = {}): VirtualSetLight => ({
  id: id(`light-${type}`),
  name: `${type === 'directional' ? 'Sun' : type === 'area' ? 'Softbox' : type === 'panel' ? 'Glow Panel' : type} ${index}`,
  type,
  enabled: true,
  color: type === 'panel' ? '#baff29' : '#fff6df',
  intensity: type === 'directional' ? 1.8 : type === 'area' ? 7 : type === 'panel' ? 6 : 2.6,
  temperature: 5600,
  range: type === 'point' ? 8 : 14,
  angle: type === 'spot' ? 32 : 60,
  penumbra: 0.45,
  softness: type === 'directional' ? 2.5 : 1.2,
  width: type === 'area' || type === 'panel' ? 2.4 : 1,
  height: type === 'area' || type === 'panel' ? 1.4 : 1,
  transform: defaultTransform(type === 'directional'
    ? { x: -3.4, y: 5.4, z: 3.5, rotationX: -38, rotationY: -35 }
    : type === 'area'
      ? { x: -2.2, y: 3.4, z: 2.4, rotationX: -38, rotationY: -28 }
      : type === 'panel'
        ? { x: 1.8, y: 1.8, z: -1.4, rotationY: -25, scaleX: 1.1, scaleY: 1.1 }
        : { x: 1.8, y: 2.4, z: 2.2 }),
  ...overrides,
});

const createObject = (
  type: VirtualSetObjectType,
  index = 1,
  options: { image?: ImageState | null; assetId?: string | null; material?: Partial<VirtualSetMaterial> } = {},
): VirtualSetObject => {
  const defaults: Record<VirtualSetObjectType, { material: VirtualSetMaterialPreset; transform?: Partial<VirtualSetTransform> }> = {
    plane: { material: 'matte-paper' },
    wall: { material: 'matte-paper', transform: { y: 1.5, z: -2.4, scaleX: 1.4 } },
    cube: { material: 'glossy-acrylic', transform: { y: 0.65 } },
    sphere: { material: 'chrome', transform: { y: 0.75 } },
    cylinder: { material: 'studio-floor', transform: { y: 0.45, scaleX: 1.1, scaleY: 0.7, scaleZ: 1.1 } },
    backdrop: { material: 'matte-paper', transform: { y: 1.05, z: -1.65, scaleX: 1.3 } },
    platform: { material: 'studio-floor', transform: { y: -0.12, scaleX: 1.35, scaleY: 1, scaleZ: 1.1 } },
    'image-plane': { material: 'matte-paper', transform: { y: 1.45, z: -1.2, scaleX: 1.1, scaleY: 1.1 } },
    model: { material: 'studio-floor', transform: { y: 0.1, scaleX: 1.35, scaleY: 1.35, scaleZ: 1.35 } },
  };
  const objectDefaults = defaults[type];
  return {
    id: id(type),
    name: options.image?.fileName || `${type.replace('-', ' ')} ${index}`,
    type,
    visible: true,
    locked: false,
    transform: defaultTransform(objectDefaults.transform),
    material: materialFromPreset(objectDefaults.material, options.material),
    image: options.image || null,
    assetId: options.assetId || null,
  };
};

const createScene = (): VirtualSetScene => {
  const presetColor = '#edf1f4';
  const skyPreset: VirtualSetSkyPreset = 'clear';
  const objects: VirtualSetObject[] = [
    createObject('platform', 1, { material: { color: '#d8dce2', roughness: 0.62, reflectionIntensity: 0.24 } }),
    createObject('cube', 1, { material: { color: '#ffffff', roughness: 0.48, metallic: 0, reflectionIntensity: 0.38 } }),
  ];
  objects[0].name = 'Starter Checker Platform';
  objects[0].transform = defaultTransform({ y: -0.18 });
  objects[1].name = 'White Starter Box';
  objects[1].transform = defaultTransform({ y: 0.68 });

  return {
    id: id('virtual-set'),
    name: 'Virtual Set',
    preset: 'studio-cyc',
    width: 1920,
    height: 1080,
    backgroundColor: presetColor,
    selectedObjectId: objects[1]?.id || objects[0]?.id || null,
    objects,
    assets: [],
    materials: Object.keys(materialPresets).map((key) => materialFromPreset(key as VirtualSetMaterialPreset)),
    lights: [
      createLight('directional', 1, { name: 'Daylight Sun', intensity: 2.4, color: '#fff3d3', temperature: 5600, transform: defaultTransform({ x: -18, y: 24, z: 14, rotationX: -48, rotationY: -38 }) }),
    ],
    environment: defaultEnvironment(skyPreset),
    rendererSettings: defaultRendererSettings(),
    camera: defaultCamera(),
    lighting: defaultLighting(skyPreset),
    renders: [],
    updatedAt: Date.now(),
  };
};

const legacyObjectToNative = (object: Partial<VirtualSetObject> & { color?: string; roughness?: number; metallic?: number }): VirtualSetObject => {
  const fallback = object.type === 'sphere' ? 'chrome' : object.type === 'platform' ? 'studio-floor' : 'matte-paper';
  return {
    id: object.id || id('object'),
    name: object.name || 'Object',
    type: object.type || 'cube',
    visible: object.visible !== false,
    locked: Boolean(object.locked),
    transform: { ...defaultTransform(), ...(object.transform || {}) },
    material: {
      ...normalizeMaterial(object.material, fallback),
      color: object.material?.color || object.color || '#d8dde4',
      roughness: object.material?.roughness ?? object.roughness ?? 0.55,
      metallic: object.material?.metallic ?? object.metallic ?? 0,
    },
    image: object.image || null,
    assetId: object.assetId || null,
  };
};

const normalizeScene = (scene: VirtualSetScene | undefined): VirtualSetScene => {
  if (!scene) return createScene();
  const base = createScene();
  const incomingSettings = { ...base.rendererSettings, ...(scene.rendererSettings || {}), renderState: 'preview' as VirtualSetRenderState };
  return {
    ...base,
    ...scene,
    camera: { ...base.camera, ...(scene.camera || {}) },
    lighting: { ...base.lighting, ...(scene.lighting || {}) },
    environment: { ...base.environment, ...(scene.environment || {}) },
    rendererSettings: {
      ...incomingSettings,
      previewQuality: 'ultra',
      samples: clamp(incomingSettings.samples || base.rendererSettings.samples, 1, 512),
      bounces: clamp(incomingSettings.bounces || base.rendererSettings.bounces, 1, 16),
      shadowQuality: clamp(incomingSettings.shadowQuality || base.rendererSettings.shadowQuality, 512, 4096),
    },
    assets: Array.isArray(scene.assets)
      ? scene.assets.map((asset) => ({ ...asset, dataUrl: typeof asset.dataUrl === 'string' ? asset.dataUrl : '' }))
      : [],
    materials: Array.isArray(scene.materials) && scene.materials.length > 0
      ? scene.materials.map((material) => normalizeMaterial(material, material.preset || 'matte-paper'))
      : base.materials,
    lights: Array.isArray(scene.lights) && scene.lights.length > 0
      ? scene.lights.map((light) => ({ ...createLight(light.type || 'area'), ...light, transform: { ...defaultTransform(), ...(light.transform || {}) } }))
      : base.lights,
    objects: Array.isArray(scene.objects) ? scene.objects.map(legacyObjectToNative) : base.objects,
    renders: Array.isArray(scene.renders) ? scene.renders : [],
  };
};

const imageStateFromDataUrl = (dataUrl: string, fileName: string, width: number | null, height: number | null): ImageState => {
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

const assetDataUrl = (scene: VirtualSetScene, assetId?: string | null) => {
  const dataUrl = scene.assets.find((asset) => asset.id === assetId)?.dataUrl;
  return typeof dataUrl === 'string' && dataUrl.length > 0 ? dataUrl : null;
};
const assetById = (scene: VirtualSetScene, assetId?: string | null) => scene.assets.find((asset) => asset.id === assetId) || null;
const fieldLabel = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());

const fileExtension = (fileName: string) => fileName.toLowerCase().split('.').pop() || '';
const modelFileExtensions = new Set(['glb', 'gltf', 'fbx', 'obj']);
const isModelFile = (file: File) => modelFileExtensions.has(fileExtension(file.name)) || file.type.includes('gltf') || file.type.includes('obj');
const modelMimeType = (file: File) => {
  const extension = fileExtension(file.name);
  if (file.type) return file.type;
  if (extension === 'glb') return 'model/gltf-binary';
  if (extension === 'gltf') return 'model/gltf+json';
  if (extension === 'fbx') return 'model/fbx';
  if (extension === 'obj') return 'model/obj';
  return 'application/octet-stream';
};
const modelResourceDataUrl = (asset: VirtualSetAsset, resourceUrl: string) => {
  const cleanUrl = resourceUrl.split(/[?#]/)[0] || resourceUrl;
  const fileName = decodeURIComponent(cleanUrl.split(/[\\/]/).filter(Boolean).at(-1) || cleanUrl).toLowerCase();
  if (!fileName) return null;
  if (asset.fileName.toLowerCase() === fileName) return asset.dataUrl;
  return asset.resources?.find((resource) => resource.fileName.toLowerCase() === fileName)?.dataUrl || null;
};

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
      <span className="font-mono text-[var(--color-text)]">{Number(value).toFixed(step < 1 ? 2 : 0)}</span>
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

const ToggleField: React.FC<{ label: string; checked: boolean; onChange: (checked: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-bold text-[var(--color-text)]">
    {label}
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
  </label>
);

const GlassPanel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-[24px] border border-white/10 bg-black/45 shadow-2xl shadow-black/30 backdrop-blur-2xl ${className}`}>
    {children}
  </div>
);

const ControlCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-white/10 bg-white/[0.045] p-3 transition hover:border-[var(--color-accent)]/30 hover:bg-white/[0.07] ${className}`}>
    {children}
  </div>
);

const ActionButton: React.FC<{
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
}> = ({ children, icon, onClick, disabled = false, variant = 'secondary', className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${
      variant === 'primary'
        ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)] text-black shadow-[0_0_28px_rgba(186,255,41,0.22)] hover:brightness-110'
        : variant === 'danger'
          ? 'border-red-400/20 bg-red-500/15 text-red-100 hover:bg-red-500/25'
          : 'border-white/10 bg-white/[0.06] text-white hover:border-white/20 hover:bg-white/[0.1]'
    } ${className}`}
  >
    {icon}
    {children}
  </button>
);

const PresetChip: React.FC<{
  label: string;
  description?: string;
  active?: boolean;
  onClick: () => void;
}> = ({ label, description, active = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`min-w-[104px] rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${
      active
        ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)] text-black shadow-[0_0_24px_rgba(186,255,41,0.2)]'
        : 'border-white/10 bg-white/[0.045] text-white hover:border-[var(--color-accent)]/35 hover:bg-white/[0.075]'
    }`}
  >
    <span className="block text-xs font-black">{label}</span>
    {description && <span className={`mt-1 block text-[10px] leading-4 ${active ? 'text-black/65' : 'text-white/45'}`}>{description}</span>}
  </button>
);

const SliderCard: React.FC<{
  icon?: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}> = ({ icon, label, value, min, max, step, onChange, suffix = '' }) => (
  <ControlCard>
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-[var(--color-accent)]">{icon}</span>}
        <span className="truncate text-xs font-black text-white">{label}</span>
      </div>
      <span className="rounded-full bg-black/35 px-2.5 py-1 text-[10px] font-black text-white/75">{Number(value).toFixed(step < 1 ? 2 : 0)}{suffix}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-2 w-full cursor-pointer accent-[var(--color-accent)]"
    />
  </ControlCard>
);

const ToggleCard: React.FC<{
  icon?: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ icon, label, description, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${
      checked
        ? 'border-[var(--color-accent)]/45 bg-[var(--color-accent)]/14 shadow-[0_0_22px_rgba(186,255,41,0.12)]'
        : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
    }`}
  >
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${checked ? 'bg-[var(--color-accent)] text-black' : 'bg-white/[0.07] text-white/65'}`}>
      {icon || <SparklesIcon className="h-4 w-4" />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-xs font-black text-white">{label}</span>
      <span className="mt-0.5 block text-[10px] leading-4 text-white/45">{description}</span>
    </span>
    <span className={`h-6 w-11 rounded-full p-1 transition ${checked ? 'bg-[var(--color-accent)]' : 'bg-white/10'}`}>
      <span className={`block h-4 w-4 rounded-full bg-black transition ${checked ? 'translate-x-5' : 'translate-x-0 bg-white/55'}`} />
    </span>
  </button>
);

const CollapsibleSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const reduceMotion = useReducedMotion();
  return (
    <GlassPanel className="overflow-hidden">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex min-w-0 items-center gap-2">
          {icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-[var(--color-accent)]">{icon}</span>}
          <span className="truncate text-sm font-black text-white">{title}</span>
        </span>
        <span className={`text-lg font-black text-white/45 transition ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      <motion.div
        initial={false}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
        className="overflow-hidden"
      >
        <div className="space-y-3 px-4 pb-4">{children}</div>
      </motion.div>
    </GlassPanel>
  );
};

const RenderHistoryCard: React.FC<{
  render: VirtualSetRender;
  onView: () => void;
  onUse: () => void;
  onDownload: () => void;
}> = ({ render, onView, onUse, onDownload }) => (
  <ControlCard className="overflow-hidden p-0">
    <img src={render.dataUrl} alt={render.name} className="aspect-video w-full object-cover" />
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs font-black text-white">{new Date(render.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <span className="rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-black uppercase text-white/55">{render.width}x{render.height}</span>
      </div>
      <span className="block truncate text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-accent)]">{render.mode || 'preview'}</span>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onView} className="rounded-lg bg-white/[0.07] px-2 py-1.5 text-[10px] font-black text-white hover:bg-white/[0.12]">View</button>
        <button type="button" onClick={onUse} className="rounded-lg bg-[var(--color-accent)]/15 px-2 py-1.5 text-[10px] font-black text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25">Use</button>
        <button type="button" onClick={onDownload} className="rounded-lg bg-white/[0.07] px-2 py-1.5 text-[10px] font-black text-white hover:bg-white/[0.12]">Save</button>
      </div>
    </div>
  </ControlCard>
);

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
  reader.readAsDataURL(file);
});

const imageSizeFromDataUrl = (dataUrl: string) => new Promise<{ width: number | null; height: number | null }>((resolve) => {
  const image = new Image();
  image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
  image.onerror = () => resolve({ width: null, height: null });
  image.src = dataUrl;
});

const downloadDataUrl = (dataUrl: string, name: string) => {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = name;
  anchor.click();
};

const applyTransform = (target: THREE.Object3D, transform: VirtualSetTransform) => {
  target.position.set(transform.x, transform.y, transform.z);
  target.rotation.set(toRadians(transform.rotationX), toRadians(transform.rotationY), toRadians(transform.rotationZ));
  target.scale.set(transform.scaleX, transform.scaleY, transform.scaleZ);
};

const extractTransform = (target: THREE.Object3D): VirtualSetTransform => ({
  x: Number(target.position.x.toFixed(3)),
  y: Number(target.position.y.toFixed(3)),
  z: Number(target.position.z.toFixed(3)),
  rotationX: Number(toDegrees(target.rotation.x).toFixed(2)),
  rotationY: Number(toDegrees(target.rotation.y).toFixed(2)),
  rotationZ: Number(toDegrees(target.rotation.z).toFixed(2)),
  scaleX: Number(target.scale.x.toFixed(3)),
  scaleY: Number(target.scale.y.toFixed(3)),
  scaleZ: Number(target.scale.z.toFixed(3)),
});

const cameraFromThree = (camera: THREE.PerspectiveCamera, controls: OrbitControls, current: VirtualSetCamera): VirtualSetCamera => ({
  ...current,
  x: Number(camera.position.x.toFixed(4)),
  y: Number(camera.position.y.toFixed(4)),
  z: Number(camera.position.z.toFixed(4)),
  targetX: Number(controls.target.x.toFixed(4)),
  targetY: Number(controls.target.y.toFixed(4)),
  targetZ: Number(controls.target.z.toFixed(4)),
});

const colorFromKelvin = (kelvin: number, fallback: string) => {
  const normalized = clamp((kelvin - 2500) / 6500, 0, 1);
  return new THREE.Color('#ffb46b').lerp(hexToThree(fallback), normalized).lerp(new THREE.Color('#c8ddff'), Math.max(0, normalized - 0.7) * 0.22);
};

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose?.();
  });
};

const findSelectable = (object: THREE.Object3D | null): { kind: 'object' | 'light'; id: string } | null => {
  let current: THREE.Object3D | null = object;
  while (current) {
    const kind = current.userData?.virtualSetKind as 'object' | 'light' | undefined;
    const idValue = current.userData?.virtualSetId as string | undefined;
    if ((kind === 'object' || kind === 'light') && idValue) return { kind, id: idValue };
    current = current.parent;
  }
  return null;
};

const stageSurfaceTypes = new Set<VirtualSetObjectType>(['platform', 'backdrop', 'wall', 'plane']);

const pickSelectableFromHits = (hits: THREE.Intersection<THREE.Object3D>[], sceneData: VirtualSetScene) => {
  const seen = new Set<string>();
  const candidates = hits.flatMap((hit) => {
    const selected = findSelectable(hit.object);
    if (!selected) return [];
    const key = `${selected.kind}:${selected.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const sceneObject = selected.kind === 'object'
      ? sceneData.objects.find((object) => object.id === selected.id)
      : null;
    return [{ selected, distance: hit.distance, sceneObject }];
  });

  const first = candidates[0];
  if (!first) return null;

  const preferredAsset = candidates.find((candidate) => (
    candidate.selected.kind === 'object'
    && candidate.sceneObject
    && !stageSurfaceTypes.has(candidate.sceneObject.type)
    && candidate.distance <= first.distance + 0.08
  ));

  return preferredAsset?.selected || first.selected;
};

const rebuildPreviewComposer = (runtime: ThreeRuntime, sceneData: VirtualSetScene) => {
  runtime.composer?.dispose();
  runtime.composer = null;

  const settings = sceneData.rendererSettings;
  const effects = [];
  if (settings.enableSSAO) {
    effects.push(new SSAOEffect(runtime.camera, undefined, {
      samples: settings.previewQuality === 'ultra' ? 17 : 11,
      rings: 7,
      radius: 0.16,
      intensity: settings.ambientOcclusionIntensity,
      luminanceInfluence: 0.35,
      bias: 0.025,
      resolutionScale: settings.previewQuality === 'draft' ? 0.5 : 0.75,
    }));
  }
  if (settings.enableBloom) {
    effects.push(new BloomEffect({
      intensity: settings.bloomIntensity,
      luminanceThreshold: settings.bloomThreshold,
      luminanceSmoothing: 0.08,
      mipmapBlur: true,
      radius: 0.72,
    }));
  }
  if (settings.enableDepthOfField) {
    effects.push(new DepthOfFieldEffect(runtime.camera, {
      focusDistance: sceneData.camera.focusDistance,
      focusRange: Math.max(0.12, 4 / Math.max(0.25, settings.depthOfFieldStrength)),
      bokehScale: settings.depthOfFieldStrength,
      resolutionScale: settings.previewQuality === 'ultra' ? 0.65 : 0.5,
    }));
  }
  if (settings.enableVignette) {
    effects.push(new VignetteEffect({
      offset: 0.28,
      darkness: settings.vignetteStrength,
    }));
  }

  if (effects.length === 0) return;
  const composer = new EffectComposer(runtime.renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: settings.previewQuality === 'ultra' ? 4 : 0,
  });
  composer.addPass(new RenderPass(runtime.scene, runtime.camera));
  composer.addPass(new EffectPass(runtime.camera, ...effects));
  const size = runtime.renderer.getSize(new THREE.Vector2());
  composer.setSize(size.x, size.y, false);
  runtime.composer = composer;
};

const createEnvironment = (pmrem: THREE.PMREMGenerator, scene: THREE.Scene, sceneData: VirtualSetScene) => {
  const { environment } = sceneData;
  const skyImageUrl = assetDataUrl(sceneData, environment.hdriAssetId);
  const hasSkyLight = Boolean(skyImageUrl) || environment.ambientIntensity > 0 || environment.reflectionIntensity > 0;
  const showBackground = environment.showBackground !== false;
  if (!hasSkyLight) {
    scene.background = new THREE.Color('#000000');
    scene.environment = null;
    scene.fog = null;
    return null;
  }

  let sourceTexture: THREE.Texture;
  if (skyImageUrl) {
    let envTarget: THREE.WebGLRenderTarget | null = null;
    let disposed = false;
    sourceTexture = new THREE.TextureLoader().load(skyImageUrl, (loadedTexture) => {
      if (disposed) {
        loadedTexture.dispose();
        return;
      }
      loadedTexture.colorSpace = THREE.SRGBColorSpace;
      loadedTexture.mapping = THREE.EquirectangularReflectionMapping;
      envTarget?.dispose();
      envTarget = pmrem.fromEquirectangular(loadedTexture);
      scene.background = showBackground ? loadedTexture : new THREE.Color(environment.backgroundBottom);
      scene.environment = environment.reflectionIntensity > 0 ? envTarget.texture : null;
    });
    sourceTexture.colorSpace = THREE.SRGBColorSpace;
    sourceTexture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = showBackground ? sourceTexture : new THREE.Color(environment.backgroundBottom);
    scene.environment = null;
    scene.fog = environment.fog > 0 ? new THREE.FogExp2(environment.fogColor, environment.fog * 0.035) : null;
    return {
      dispose: () => {
        disposed = true;
        envTarget?.dispose();
        sourceTexture.dispose();
      },
    };
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, environment.backgroundTop || '#63b3ff');
      gradient.addColorStop(0.55, '#b8dcff');
      gradient.addColorStop(1, environment.backgroundBottom || '#eef7ff');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 0.42;
      const drawCloud = (x: number, y: number, scale: number) => {
        const cloudGradient = context.createRadialGradient(x, y, 2, x, y, 120 * scale);
        cloudGradient.addColorStop(0, 'rgba(255,255,255,0.92)');
        cloudGradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = cloudGradient;
        for (let i = 0; i < 6; i += 1) {
          context.beginPath();
          context.ellipse(x + (i - 2.5) * 42 * scale, y + Math.sin(i) * 12 * scale, 60 * scale, 18 * scale, 0, 0, Math.PI * 2);
          context.fill();
        }
      };
      drawCloud(190, 330, 1);
      drawCloud(520, 285, 0.82);
      drawCloud(820, 345, 1.15);
      context.globalAlpha = 1;
    }
    sourceTexture = new THREE.CanvasTexture(canvas);
    sourceTexture.colorSpace = THREE.SRGBColorSpace;
    sourceTexture.mapping = THREE.EquirectangularReflectionMapping;
  }
  const envTarget = pmrem.fromEquirectangular(sourceTexture);
  scene.background = showBackground ? sourceTexture : new THREE.Color(environment.backgroundBottom);
  scene.environment = environment.reflectionIntensity > 0 || skyImageUrl ? envTarget.texture : null;
  scene.fog = environment.fog > 0 ? new THREE.FogExp2(environment.fogColor, environment.fog * 0.035) : null;
  return {
    dispose: () => {
      envTarget.dispose();
      sourceTexture.dispose();
    },
  };
};

const makeTexture = (dataUrl: string, colorSpace = THREE.NoColorSpace) => {
  const texture = new THREE.TextureLoader().load(dataUrl);
  texture.colorSpace = colorSpace;
  texture.anisotropy = 16;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
};

let checkerTexture: THREE.CanvasTexture | null = null;
const starterCheckerTexture = () => {
  if (checkerTexture) return checkerTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (context) {
    const cell = 64;
    for (let y = 0; y < canvas.height; y += cell) {
      for (let x = 0; x < canvas.width; x += cell) {
        context.fillStyle = (x / cell + y / cell) % 2 === 0 ? '#cfd4dc' : '#aeb6c2';
        context.fillRect(x, y, cell, cell);
      }
    }
    context.strokeStyle = 'rgba(255,255,255,0.28)';
    context.lineWidth = 2;
    for (let i = 0; i <= canvas.width; i += cell) {
      context.beginPath();
      context.moveTo(i, 0);
      context.lineTo(i, canvas.height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, i);
      context.lineTo(canvas.width, i);
      context.stroke();
    }
  }
  checkerTexture = new THREE.CanvasTexture(canvas);
  checkerTexture.colorSpace = THREE.SRGBColorSpace;
  checkerTexture.wrapS = THREE.RepeatWrapping;
  checkerTexture.wrapT = THREE.RepeatWrapping;
  checkerTexture.repeat.set(18, 18);
  checkerTexture.anisotropy = 16;
  checkerTexture.needsUpdate = true;
  return checkerTexture;
};

const tuneTextureQuality = (texture: THREE.Texture | null | undefined, colorSpace = THREE.NoColorSpace) => {
  if (!texture) return;
  texture.colorSpace = colorSpace;
  texture.anisotropy = Math.max(texture.anisotropy || 1, 16);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
};

const makePhysicalMaterial = (object: VirtualSetObject, sceneData: VirtualSetScene, hasEnvironmentLight: boolean) => {
  const source = object.material;
  const albedoUrl = object.type === 'image-plane'
    ? assetDataUrl(sceneData, object.assetId) || (object.image ? dataUrlFromImage(object.image) : null)
    : assetDataUrl(sceneData, source.textureAssetId);
  const material = new THREE.MeshPhysicalMaterial({
    color: albedoUrl ? '#ffffff' : source.color,
    roughness: clamp(source.roughness, 0, 1),
    metalness: clamp(source.metallic, 0, 1),
    clearcoat: clamp(source.clearcoat ?? 0, 0, 1),
    clearcoatRoughness: clamp(source.clearcoatRoughness ?? source.roughness ?? 0.2, 0, 1),
    transmission: clamp(source.transmission ?? 0, 0, 1),
    opacity: clamp(source.opacity ?? 1, 0.02, 1),
    transparent: (source.opacity ?? 1) < 0.999 || (source.transmission ?? 0) > 0,
    ior: clamp(source.ior ?? 1.5, 1, 2.5),
    thickness: clamp(source.thickness ?? 0, 0, 2),
    envMapIntensity: hasEnvironmentLight ? clamp((source.reflectionIntensity ?? 0.5) * sceneData.environment.reflectionIntensity, 0, 6) : 0,
    emissive: source.emissive || '#000000',
    emissiveIntensity: clamp(source.emissiveIntensity ?? 0, 0, 20),
    side: object.type === 'image-plane' || object.type === 'plane' || object.type === 'backdrop' || object.type === 'wall' ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.specularIntensity = clamp(source.specularIntensity ?? 1, 0, 2);
  if (albedoUrl) material.map = makeTexture(albedoUrl, THREE.SRGBColorSpace);
  else if (object.type === 'platform') {
    material.map = starterCheckerTexture();
    material.color.set('#ffffff');
  }
  const normalUrl = assetDataUrl(sceneData, source.normalAssetId);
  if (normalUrl) {
    material.normalMap = makeTexture(normalUrl);
    material.normalScale = new THREE.Vector2(source.normalStrength ?? 1, source.normalStrength ?? 1);
  }
  const roughnessUrl = assetDataUrl(sceneData, source.roughnessAssetId);
  if (roughnessUrl) material.roughnessMap = makeTexture(roughnessUrl);
  const metalnessUrl = assetDataUrl(sceneData, source.metalnessAssetId);
  if (metalnessUrl) material.metalnessMap = makeTexture(metalnessUrl);
  return material;
};

const createPrimitive = (object: VirtualSetObject, sceneData: VirtualSetScene, material: THREE.MeshPhysicalMaterial) => {
  let geometry: THREE.BufferGeometry;
  if (object.type === 'sphere') geometry = new THREE.SphereGeometry(0.75, 96, 64);
  else if (object.type === 'cylinder') geometry = new THREE.CylinderGeometry(0.65, 0.65, 1.3, 96);
  else if (object.type === 'wall') geometry = new THREE.BoxGeometry(4.5, 2.8, 0.12);
  else if (object.type === 'platform') geometry = new THREE.BoxGeometry(50, 0.36, 50);
  else if (object.type === 'backdrop') geometry = new THREE.BoxGeometry(4.6, 3.2, 0.1);
  else if (object.type === 'plane' || object.type === 'image-plane') {
    const asset = assetById(sceneData, object.assetId);
    const ratio = asset?.width && asset?.height ? asset.width / asset.height : 1.52;
    geometry = new THREE.PlaneGeometry(2.7 * ratio, 2.7);
  } else {
    geometry = new THREE.BoxGeometry(1.35, 1.35, 1.35);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.virtualSetKind = 'object';
  mesh.userData.virtualSetId = object.id;
  applyTransform(mesh, object.transform);
  return mesh;
};

const normalizeImportedModel = (model: THREE.Object3D) => {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxSize) || maxSize <= 0) return;
  const scale = 1.8 / maxSize;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);

  const normalizedBox = new THREE.Box3().setFromObject(model);
  const center = normalizedBox.getCenter(new THREE.Vector3());
  const normalizedSize = normalizedBox.getSize(new THREE.Vector3());
  model.position.sub(center);
  model.position.y += normalizedSize.y / 2;
  model.updateMatrixWorld(true);
};

const enhanceImportedMaterial = (material: THREE.Material, object: VirtualSetObject, sceneData: VirtualSetScene, hasEnvironmentLight: boolean) => {
  const source = object.material;
  const standard = material as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial;
  const hasPbrSurface = Boolean((standard as THREE.MeshStandardMaterial).isMeshStandardMaterial || (standard as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial);
  const target = hasPbrSurface
    ? standard
    : new THREE.MeshPhysicalMaterial({
      color: (material as THREE.MeshBasicMaterial).color || source.color,
      map: (material as THREE.MeshBasicMaterial).map || null,
      roughness: source.roughness,
      metalness: source.metallic,
    });

  const albedoUrl = assetDataUrl(sceneData, source.textureAssetId);
  const normalUrl = assetDataUrl(sceneData, source.normalAssetId);
  const roughnessUrl = assetDataUrl(sceneData, source.roughnessAssetId);
  const metalnessUrl = assetDataUrl(sceneData, source.metalnessAssetId);

  if (albedoUrl) target.map = makeTexture(albedoUrl, THREE.SRGBColorSpace);
  if (normalUrl) target.normalMap = makeTexture(normalUrl);
  if (roughnessUrl) target.roughnessMap = makeTexture(roughnessUrl);
  if (metalnessUrl) target.metalnessMap = makeTexture(metalnessUrl);

  tuneTextureQuality(target.map, THREE.SRGBColorSpace);
  tuneTextureQuality(target.normalMap);
  tuneTextureQuality(target.roughnessMap);
  tuneTextureQuality(target.metalnessMap);
  tuneTextureQuality(target.aoMap);
  tuneTextureQuality(target.emissiveMap, THREE.SRGBColorSpace);

  if (!target.map) target.color.set(source.color);
  target.roughness = clamp(source.roughness, 0, 1);
  target.metalness = clamp(source.metallic, 0, 1);
  target.envMapIntensity = hasEnvironmentLight ? clamp((source.reflectionIntensity ?? 0.5) * sceneData.environment.reflectionIntensity, 0, 6) : 0;
  target.opacity = clamp(source.opacity ?? 1, 0.02, 1);
  target.transparent = target.opacity < 0.999 || (source.transmission ?? 0) > 0;
  target.emissive = hexToThree(source.emissive || '#000000');
  target.emissiveIntensity = clamp(source.emissiveIntensity ?? 0, 0, 20);
  target.side = THREE.DoubleSide;
  target.shadowSide = THREE.DoubleSide;
  target.needsUpdate = true;

  if ('normalScale' in target) {
    target.normalScale = new THREE.Vector2(source.normalStrength ?? 1, source.normalStrength ?? 1);
  }
  if ('clearcoat' in target) {
    target.clearcoat = clamp(source.clearcoat ?? 0, 0, 1);
    target.clearcoatRoughness = clamp(source.clearcoatRoughness ?? source.roughness ?? 0.2, 0, 1);
    target.transmission = clamp(source.transmission ?? 0, 0, 1);
    target.ior = clamp(source.ior ?? 1.5, 1, 2.5);
    target.thickness = clamp(source.thickness ?? 0, 0, 2);
  }
  if ('specularIntensity' in target) {
    target.specularIntensity = clamp(source.specularIntensity ?? 1, 0, 2);
  }

  return target;
};

const prepareImportedModel = (model: THREE.Object3D, object: VirtualSetObject, sceneData: VirtualSetScene, fallbackMaterial: THREE.Material, hasEnvironmentLight: boolean) => {
  model.traverse((child) => {
    child.userData.virtualSetKind = 'object';
    child.userData.virtualSetId = object.id;
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    if (!mesh.material) {
      mesh.material = fallbackMaterial;
      return;
    }
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => enhanceImportedMaterial(material, object, sceneData, hasEnvironmentLight))
      : enhanceImportedMaterial(mesh.material, object, sceneData, hasEnvironmentLight);
  });
  normalizeImportedModel(model);
};

const createLightHandleMaterial = (light: VirtualSetLight) => new THREE.MeshBasicMaterial({
  color: light.enabled ? light.color : '#4b5563',
  transparent: true,
  opacity: light.enabled ? 0.92 : 0.48,
  toneMapped: false,
});

const createLightHandle = (light: VirtualSetLight) => {
  const group = new THREE.Group();
  group.name = `handle-${light.id}`;
  group.userData.virtualSetKind = 'light';
  group.userData.virtualSetId = light.id;
  const material = createLightHandleMaterial(light);
  const size = light.type === 'directional' ? 0.34 : light.type === 'area' || light.type === 'panel' ? 0.52 : 0.4;
  let mesh: THREE.Mesh;
  if (light.type === 'area' || light.type === 'panel') mesh = new THREE.Mesh(new THREE.PlaneGeometry(light.width, light.height), material);
  else if (light.type === 'spot') mesh = new THREE.Mesh(new THREE.ConeGeometry(size * 0.5, size * 1.1, 24), material);
  else if (light.type === 'directional') mesh = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.5, size * 0.5, size * 0.28, 24), material);
  else mesh = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 24, 16), material);
  mesh.userData.virtualSetKind = 'light';
  mesh.userData.virtualSetId = light.id;
  group.add(mesh);
  applyTransform(group, light.transform);
  return group;
};

const VirtualSetViewport = forwardRef<VirtualSetViewportHandle, {
  sceneData: VirtualSetScene;
  selectedObjectId: string | null;
  selectedLightId: string | null;
  transformMode: TransformMode;
  onSelectObject: (id: string | null) => void;
  onSelectLight: (id: string | null) => void;
  onObjectTransform: (id: string, transform: VirtualSetTransform) => void;
  onLightTransform: (id: string, transform: VirtualSetTransform) => void;
  onCameraChange: (camera: VirtualSetCamera) => void;
  onViewportError?: (message: string | null) => void;
  snapToGrid: boolean;
}>(({ sceneData, selectedObjectId, selectedLightId, transformMode, onSelectObject, onSelectLight, onObjectTransform, onLightTransform, onCameraChange, onViewportError, snapToGrid }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<ThreeRuntime | null>(null);
  const sceneDataRef = useRef(sceneData);
  const selectedObjectIdRef = useRef(selectedObjectId);
  const selectedLightIdRef = useRef(selectedLightId);
  const transformModeRef = useRef(transformMode);
  const snapToGridRef = useRef(snapToGrid);
  const onSelectObjectRef = useRef(onSelectObject);
  const onSelectLightRef = useRef(onSelectLight);
  const onObjectTransformRef = useRef(onObjectTransform);
  const onLightTransformRef = useRef(onLightTransform);
  const onCameraChangeRef = useRef(onCameraChange);
  const objectMapRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const lightMapRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const liveLightMapRef = useRef<Map<string, LiveLightBinding>>(new Map());
  const envTargetRef = useRef<{ dispose: () => void } | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const hoveredRef = useRef(false);
  const lastCameraSaveRef = useRef(0);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const pointerClickStartRef = useRef<{ x: number; y: number; button: number } | null>(null);

  useEffect(() => {
    sceneDataRef.current = sceneData;
    selectedObjectIdRef.current = selectedObjectId;
    selectedLightIdRef.current = selectedLightId;
    transformModeRef.current = transformMode;
    snapToGridRef.current = snapToGrid;
    onSelectObjectRef.current = onSelectObject;
    onSelectLightRef.current = onSelectLight;
    onObjectTransformRef.current = onObjectTransform;
    onLightTransformRef.current = onLightTransform;
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange, onLightTransform, onObjectTransform, onSelectLight, onSelectObject, sceneData, selectedLightId, selectedObjectId, snapToGrid, transformMode]);

  const rebuildKey = useMemo(() => JSON.stringify({
    objects: sceneData.objects,
    assets: sceneData.assets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name,
      fileName: asset.fileName,
      width: asset.width,
      height: asset.height,
      dataUrlLength: typeof asset.dataUrl === 'string' ? asset.dataUrl.length : 0,
    })),
    lights: sceneData.lights,
    environment: sceneData.environment,
    backgroundColor: sceneData.backgroundColor,
    shadowQuality: sceneData.rendererSettings.shadowQuality,
  }), [
    sceneData.assets,
    sceneData.backgroundColor,
    sceneData.environment,
    sceneData.lights,
    sceneData.objects,
    sceneData.rendererSettings.shadowQuality,
  ]);

  const updateGizmoAttachment = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const selected = selectedObjectIdRef.current
      ? objectMapRef.current.get(selectedObjectIdRef.current)
      : selectedLightIdRef.current
        ? lightMapRef.current.get(selectedLightIdRef.current)
        : null;
    runtime.transform.setMode(transformModeRef.current);
    runtime.transform.setTranslationSnap(snapToGridRef.current ? 0.5 : null);
    runtime.transform.setRotationSnap(snapToGridRef.current ? THREE.MathUtils.degToRad(15) : null);
    runtime.transform.setScaleSnap(snapToGridRef.current ? 0.1 : null);
    const selectedObject = selectedObjectIdRef.current
      ? sceneDataRef.current.objects.find((object) => object.id === selectedObjectIdRef.current)
      : null;
    if (selected && !selectedObject?.locked) runtime.transform.attach(selected);
    else runtime.transform.detach();
  }, []);

  const syncLiveLight = useCallback((lightId: string) => {
    const binding = liveLightMapRef.current.get(lightId);
    if (!binding) return;
    binding.handle.updateMatrixWorld(true);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    binding.handle.matrixWorld.decompose(position, rotation, scale);

    if (binding.actual) {
      binding.actual.position.copy(position);
      binding.actual.quaternion.copy(rotation);
      if (binding.actual.userData.virtualSetLightRole === 'area') {
        const area = binding.actual as THREE.RectAreaLight;
        area.width = binding.baseWidth * Math.max(0.05, scale.x);
        area.height = binding.baseHeight * Math.max(0.05, scale.y);
      }
      binding.actual.updateMatrixWorld(true);
    }

    if (binding.panel) {
      binding.panel.position.copy(position);
      binding.panel.quaternion.copy(rotation);
      binding.panel.scale.set(Math.max(0.05, scale.x), Math.max(0.05, scale.y), 1);
      binding.panel.updateMatrixWorld(true);
    }

    if (binding.target) {
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation).normalize();
      binding.target.position.copy(position).add(direction.multiplyScalar(10));
      binding.target.updateMatrixWorld(true);
    }
  }, []);

  const syncAttachedLight = useCallback(() => {
    const attached = runtimeRef.current?.transform.object;
    const selected = findSelectable(attached || null);
    if (selected?.kind === 'light') syncLiveLight(selected.id);
  }, [syncLiveLight]);

  const commitAttachedTransform = useCallback(() => {
    const runtime = runtimeRef.current;
    const attached = runtime?.transform.object;
    if (!attached) return;
    const selected = findSelectable(attached);
    if (!selected) return;
    if (selected.kind === 'light') syncLiveLight(selected.id);
    const transform = extractTransform(attached);
    if (snapToGridRef.current) {
      transform.x = Math.round(transform.x * 2) / 2;
      transform.y = Math.round(transform.y * 2) / 2;
      transform.z = Math.round(transform.z * 2) / 2;
      transform.rotationX = Math.round(transform.rotationX / 15) * 15;
      transform.rotationY = Math.round(transform.rotationY / 15) * 15;
      transform.rotationZ = Math.round(transform.rotationZ / 15) * 15;
    }
    if (selected.kind === 'object') onObjectTransformRef.current(selected.id, transform);
    else onLightTransformRef.current(selected.id, transform);
  }, [syncLiveLight]);

  const clearScene = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.transform.detach();
    disposeObject(runtime.root);
    runtime.root.clear();
    [...runtime.helpers.children].forEach((child) => {
      if (child === runtime.transformHelper) return;
      runtime.helpers.remove(child);
      disposeObject(child);
    });
    if (!runtime.helpers.children.includes(runtime.transformHelper)) {
      runtime.helpers.add(runtime.transformHelper);
    }
    envTargetRef.current?.dispose();
    envTargetRef.current = null;
    objectMapRef.current.clear();
    lightMapRef.current.clear();
    liveLightMapRef.current.clear();
  }, []);

  useImperativeHandle(ref, () => ({
    focusObject: (idValue) => {
      const runtime = runtimeRef.current;
      const target = idValue ? objectMapRef.current.get(idValue) || lightMapRef.current.get(idValue) : null;
      if (!runtime || !target) return;
      const box = new THREE.Box3().setFromObject(target);
      const center = box.isEmpty() ? target.position.clone() : box.getCenter(new THREE.Vector3());
      const size = box.isEmpty() ? new THREE.Vector3(2, 2, 2) : box.getSize(new THREE.Vector3());
      const distance = Math.max(4, size.length() * 1.8);
      runtime.controls.target.copy(center);
      runtime.camera.position.copy(center).add(new THREE.Vector3(distance * 0.72, distance * 0.52, distance * 0.85));
      runtime.camera.lookAt(center);
      runtime.controls.update();
      onCameraChangeRef.current(cameraFromThree(runtime.camera, runtime.controls, sceneDataRef.current.camera));
    },
    capture: async (options) => {
      const runtime = runtimeRef.current;
      if (!runtime) return null;
      const { renderer, scene, camera, controls, transform, transformHelper, canvas } = runtime;
      const previousSize = renderer.getSize(new THREE.Vector2());
      const previousPixelRatio = renderer.getPixelRatio();
      const previousAspect = camera.aspect;
      const previousTransformObject = transform.object;
      const previousTransformVisible = transformHelper.visible;
      const previousControlsEnabled = controls.enabled;
      const helperVisibility = runtime.helpers.visible;
      try {
        options.onProgress?.(0.04, options.mode === 'beauty' ? 'path-tracing' : 'preview');
        transform.detach();
        transformHelper.visible = false;
        controls.enabled = false;
        runtime.helpers.visible = false;
        renderer.setPixelRatio(1);
        renderer.setSize(options.width, options.height, false);
        camera.aspect = options.width / options.height;
        camera.updateProjectionMatrix();

        runtime.composer?.setSize(options.width, options.height, false);
        if (options.mode === 'beauty') {
          options.onProgress?.(0.12, 'converging');
          renderer.shadowMap.needsUpdate = true;
          const passes = 10;
          for (let pass = 0; pass < passes; pass += 1) {
            if (options.isCanceled?.()) return null;
            if (runtime.composer) runtime.composer.render();
            else renderer.render(scene, camera);
            options.onProgress?.(0.12 + ((pass + 1) / passes) * 0.84, 'converging');
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          }
        } else if (runtime.composer) {
          runtime.composer.render();
        } else {
          renderer.render(scene, camera);
        }

        options.onProgress?.(1, 'ready');
        return canvas.toDataURL(`image/${options.format}`, options.format === 'jpeg' ? 0.92 : undefined);
      } finally {
        renderer.setPixelRatio(previousPixelRatio);
        renderer.setSize(previousSize.x, previousSize.y, false);
        runtime.composer?.setSize(previousSize.x, previousSize.y, false);
        camera.aspect = previousAspect;
        camera.updateProjectionMatrix();
        controls.enabled = previousControlsEnabled;
        runtime.helpers.visible = helperVisibility;
        transformHelper.visible = previousTransformVisible;
        if (previousTransformObject) transform.attach(previousTransformObject);
      }
    },
  }), []);

  useEffect(() => {
    RectAreaLightUniformsLib.init();
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frameId = 0;

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = sceneDataRef.current.rendererSettings.exposure;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.VSMShadowMap;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.03, 250);
      camera.position.set(sceneDataRef.current.camera.x, sceneDataRef.current.camera.y, sceneDataRef.current.camera.z);
      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(sceneDataRef.current.camera.targetX, sceneDataRef.current.camera.targetY, sceneDataRef.current.camera.targetZ);
      controls.maxDistance = 120;
      controls.minDistance = 0.2;
      controls.update();

      const root = new THREE.Group();
      const helpers = new THREE.Group();
      scene.add(root, helpers);

      const transform = new TransformControls(camera, canvas);
      transform.setMode(transformModeRef.current);
      transform.setTranslationSnap(snapToGridRef.current ? 0.5 : null);
      transform.setRotationSnap(snapToGridRef.current ? THREE.MathUtils.degToRad(15) : null);
      transform.setScaleSnap(snapToGridRef.current ? 0.1 : null);
      transform.setSize(0.9);
      const transformHelper = transform.getHelper();
      transform.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
      });
      transform.addEventListener('objectChange', syncAttachedLight);
      transform.addEventListener('mouseUp', commitAttachedTransform);
      helpers.add(transformHelper);

      const pmrem = new THREE.PMREMGenerator(renderer);
      runtimeRef.current = { renderer, scene, camera, controls, transform, transformHelper, root, helpers, pmrem, composer: null, canvas };
      rebuildPreviewComposer(runtimeRef.current, sceneDataRef.current);
      onViewportError?.(null);

      const resize = () => {
        const width = Math.max(320, canvas.clientWidth || 1);
        const height = Math.max(320, canvas.clientHeight || 1);
        renderer.setPixelRatio(qualityPixelRatio[sceneDataRef.current.rendererSettings.previewQuality]);
        renderer.setSize(width, height, false);
        runtimeRef.current?.composer?.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);

      const commitCamera = (force = false) => {
        const now = performance.now();
        if (!force && now - lastCameraSaveRef.current < 650) return;
        lastCameraSaveRef.current = now;
        onCameraChangeRef.current(cameraFromThree(camera, controls, sceneDataRef.current.camera));
      };

      const pointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || transform.dragging) return;
        pointerClickStartRef.current = { x: event.clientX, y: event.clientY, button: event.button };
      };

      const pointerUp = (event: PointerEvent) => {
        const start = pointerClickStartRef.current;
        pointerClickStartRef.current = null;
        if (!start || start.button !== 0 || event.button !== 0 || transform.dragging) return;
        const dragDistance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (dragDistance > 5) return;

        const rect = canvas.getBoundingClientRect();
        pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const runtime = runtimeRef.current;
        const helperTargets = helpers.children.filter((child) => child !== runtime?.transformHelper);
        const hits = raycasterRef.current.intersectObjects([...root.children, ...helperTargets], true);
        const selected = pickSelectableFromHits(hits, sceneDataRef.current);
        if (selected?.kind === 'object') {
          const selectedNode = objectMapRef.current.get(selected.id);
          selectedObjectIdRef.current = selected.id;
          selectedLightIdRef.current = null;
          runtime?.transform.detach();
          if (selectedNode) runtime?.transform.attach(selectedNode);
          onSelectObjectRef.current(selected.id);
          onSelectLightRef.current(null);
        } else if (selected?.kind === 'light') {
          const selectedNode = lightMapRef.current.get(selected.id);
          selectedObjectIdRef.current = null;
          selectedLightIdRef.current = selected.id;
          runtime?.transform.detach();
          if (selectedNode) runtime?.transform.attach(selectedNode);
          onSelectObjectRef.current(null);
          onSelectLightRef.current(selected.id);
        }
      };

      const movementKeys = new Set(['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
      const keyDown = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();
        if (!hoveredRef.current || !movementKeys.has(key)) return;
        event.preventDefault();
        pressedKeysRef.current.add(key);
      };
      const keyUp = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();
        if (!movementKeys.has(key)) return;
        pressedKeysRef.current.delete(key);
        commitCamera(true);
      };
      const pointerEnter = () => {
        hoveredRef.current = true;
        canvas.focus({ preventScroll: true });
      };
      const pointerLeave = () => {
        hoveredRef.current = false;
        pressedKeysRef.current.clear();
        commitCamera(true);
      };
      canvas.addEventListener('pointerdown', pointerDown, true);
      canvas.addEventListener('pointerup', pointerUp, true);
      canvas.addEventListener('keydown', keyDown);
      canvas.addEventListener('keyup', keyUp);
      canvas.addEventListener('mouseenter', pointerEnter);
      canvas.addEventListener('mouseleave', pointerLeave);

      const animate = () => {
        frameId = window.requestAnimationFrame(animate);
        if (document.hidden) return;
        const delta = Math.min(0.05, renderer.info.render.frame ? 1 / 60 : 1 / 60);
        const keys = pressedKeysRef.current;
        if (hoveredRef.current && keys.size > 0 && !transform.dragging) {
          const forward = new THREE.Vector3();
          camera.getWorldDirection(forward);
          const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
          const up = new THREE.Vector3(0, 1, 0);
          const move = new THREE.Vector3();
          if (keys.has('w') || keys.has('arrowup')) move.add(forward);
          if (keys.has('s') || keys.has('arrowdown')) move.sub(forward);
          if (keys.has('d') || keys.has('arrowright')) move.add(right);
          if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
          if (keys.has('e')) move.add(up);
          if (keys.has('q')) move.sub(up);
          if (move.lengthSq() > 0) {
            const speed = sceneDataRef.current.camera.moveSpeed * (keys.has('shift') ? 2.5 : 1);
            move.normalize().multiplyScalar(speed * delta);
            camera.position.add(move);
            controls.target.add(move);
            commitCamera(false);
          }
        }
        if (transform.dragging) syncAttachedLight();
        controls.update();
        const runtime = runtimeRef.current;
        if (runtime?.composer) runtime.composer.render(delta);
        else renderer.render(scene, camera);
      };
      animate();

      return () => {
        window.cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
        canvas.removeEventListener('pointerdown', pointerDown, true);
        canvas.removeEventListener('pointerup', pointerUp, true);
        canvas.removeEventListener('keydown', keyDown);
        canvas.removeEventListener('keyup', keyUp);
        canvas.removeEventListener('mouseenter', pointerEnter);
        canvas.removeEventListener('mouseleave', pointerLeave);
        clearScene();
        runtimeRef.current?.composer?.dispose();
        transform.removeEventListener('objectChange', syncAttachedLight);
        transform.removeEventListener('mouseUp', commitAttachedTransform);
        transform.dispose();
        controls.dispose();
        pmrem.dispose();
        renderer.dispose();
        runtimeRef.current = null;
      };
    } catch (error) {
      onViewportError?.(error instanceof Error ? error.message : 'Three.js could not initialize the native 3D viewport.');
    }
  }, [clearScene, commitAttachedTransform, onCameraChange, onViewportError, syncAttachedLight]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { renderer, camera, controls } = runtime;
    const settings = sceneData.rendererSettings;
    renderer.setPixelRatio(qualityPixelRatio[settings.previewQuality]);
    renderer.toneMappingExposure = settings.exposure;
    camera.fov = clamp(58 - (sceneData.camera.focalLength - 24) * 0.42, 20, 72);
    camera.updateProjectionMatrix();
    rebuildPreviewComposer(runtime, sceneData);
    controls.update();
  }, [sceneData.camera.aperture, sceneData.camera.focalLength, sceneData.camera.focusDistance, sceneData.rendererSettings]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.camera.position.set(sceneData.camera.x, sceneData.camera.y, sceneData.camera.z);
    runtime.controls.target.set(sceneData.camera.targetX, sceneData.camera.targetY, sceneData.camera.targetZ);
    runtime.controls.update();
  }, [sceneData.camera]);

  useEffect(() => {
    updateGizmoAttachment();
  }, [selectedObjectId, selectedLightId, snapToGrid, transformMode, updateGizmoAttachment]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { renderer, scene, root, helpers, pmrem } = runtime;
    clearScene();
    try {
      const activeLights = sceneData.lights.filter((light) => light.enabled);
      const hasEnvironmentLight = Boolean(sceneData.environment.hdriAssetId) || sceneData.environment.ambientIntensity > 0 || sceneData.environment.reflectionIntensity > 0;
      envTargetRef.current = createEnvironment(pmrem, scene, sceneData);

      if (hasEnvironmentLight && sceneData.environment.ambientIntensity > 0) {
        const ambient = new THREE.HemisphereLight(sceneData.environment.backgroundTop, sceneData.environment.backgroundBottom, sceneData.environment.ambientIntensity);
        helpers.add(ambient);
      }

      sceneData.objects.filter((object) => object.visible).forEach((object) => {
        const material = makePhysicalMaterial(object, sceneData, hasEnvironmentLight);
        let node: THREE.Object3D;
        if (object.type === 'model') {
          const group = new THREE.Group();
          applyTransform(group, object.transform);
          group.userData.virtualSetKind = 'object';
          group.userData.virtualSetId = object.id;
          node = group;
          const asset = assetById(sceneData, object.assetId);
          const modelData = assetDataUrl(sceneData, object.assetId);
          if (asset && modelData) {
            const addFallback = () => {
              const fallback = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), material);
              fallback.userData.virtualSetKind = 'object';
              fallback.userData.virtualSetId = object.id;
              group.add(fallback);
            };
            if (fileExtension(asset.fileName) === 'obj') {
              const manager = new THREE.LoadingManager();
              manager.setURLModifier((url) => modelResourceDataUrl(asset, url) || url);
              const mtlResource = asset.resources?.find((resource) => fileExtension(resource.fileName) === 'mtl');
              const loadObj = (materials?: MTLLoader.MaterialCreator) => {
                const objLoader = new OBJLoader(manager);
                if (materials) objLoader.setMaterials(materials);
                objLoader.load(modelData, (obj) => {
                  prepareImportedModel(obj, object, sceneData, material, hasEnvironmentLight);
                  group.add(obj);
                }, undefined, addFallback);
              };
              if (mtlResource) {
                const mtlLoader = new MTLLoader(manager);
                mtlLoader.load(mtlResource.dataUrl, (materials) => {
                  materials.preload();
                  loadObj(materials);
                }, undefined, () => loadObj());
              } else {
                loadObj();
              }
            } else if (fileExtension(asset.fileName) === 'fbx') {
              const manager = new THREE.LoadingManager();
              manager.setURLModifier((url) => modelResourceDataUrl(asset, url) || url);
              const fbxLoader = new FBXLoader(manager);
              fbxLoader.load(modelData, (fbx) => {
                prepareImportedModel(fbx, object, sceneData, material, hasEnvironmentLight);
                group.add(fbx);
              }, undefined, addFallback);
            } else {
              const manager = new THREE.LoadingManager();
              manager.setURLModifier((url) => modelResourceDataUrl(asset, url) || url);
              const gltfLoader = new GLTFLoader(manager);
              gltfLoader.load(modelData, (gltf) => {
                prepareImportedModel(gltf.scene, object, sceneData, material, hasEnvironmentLight);
                group.add(gltf.scene);
              }, undefined, addFallback);
            }
          } else {
            group.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), material));
          }
        } else {
          node = createPrimitive(object, sceneData, material);
        }
        node.userData.virtualSetKind = 'object';
        node.userData.virtualSetId = object.id;
        objectMapRef.current.set(object.id, node);
        root.add(node);
      });

      sceneData.lights.forEach((light) => {
        const handle = createLightHandle(light);
        lightMapRef.current.set(light.id, handle);
        const binding: LiveLightBinding = {
          handle,
          actual: null,
          panel: null,
          target: null,
          type: light.type,
          baseWidth: light.width,
          baseHeight: light.height,
        };
        liveLightMapRef.current.set(light.id, binding);
        helpers.add(handle);
        if (!light.enabled) return;
        const color = colorFromKelvin(light.temperature, light.color);
        let actual: THREE.Object3D | null = null;
        if (light.type === 'directional') {
          const directional = new THREE.DirectionalLight(color, light.intensity);
          directional.position.copy(handle.position);
          directional.target.position.set(0, 0.8, 0);
          directional.castShadow = true;
          directional.shadow.mapSize.set(sceneData.rendererSettings.shadowQuality, sceneData.rendererSettings.shadowQuality);
          directional.shadow.bias = -0.00008;
          directional.shadow.normalBias = 0.018;
          helpers.add(directional.target);
          binding.target = directional.target;
          actual = directional;
        } else if (light.type === 'point') {
          const point = new THREE.PointLight(color, light.intensity, light.range, 2);
          point.position.copy(handle.position);
          point.castShadow = true;
          point.shadow.mapSize.set(sceneData.rendererSettings.shadowQuality, sceneData.rendererSettings.shadowQuality);
          point.shadow.bias = -0.00008;
          point.shadow.normalBias = 0.018;
          actual = point;
        } else if (light.type === 'spot') {
          const spot = new PhysicalSpotLight() as unknown as THREE.SpotLight & { radius: number };
          spot.color.copy(color);
          spot.intensity = light.intensity;
          spot.distance = light.range;
          spot.angle = toRadians(light.angle);
          spot.penumbra = light.penumbra;
          spot.decay = 1.6;
          spot.position.copy(handle.position);
          spot.rotation.copy(handle.rotation);
          spot.radius = light.softness;
          spot.castShadow = true;
          spot.shadow.mapSize.set(sceneData.rendererSettings.shadowQuality, sceneData.rendererSettings.shadowQuality);
          spot.shadow.bias = -0.00008;
          spot.shadow.normalBias = 0.018;
          helpers.add(spot.target);
          binding.target = spot.target;
          actual = spot;
        } else {
          const area = new ShapedAreaLight() as unknown as THREE.RectAreaLight & { isCircular: boolean };
          area.color.copy(color);
          area.intensity = light.intensity;
          area.width = light.width * Math.max(0.05, light.transform.scaleX);
          area.height = light.height * Math.max(0.05, light.transform.scaleY);
          area.position.copy(handle.position);
          area.rotation.copy(handle.rotation);
          area.userData.virtualSetLightRole = 'area';
          actual = area;
          const panelMaterial = new THREE.MeshPhysicalMaterial({
            color,
            emissive: color,
            emissiveIntensity: Math.max(1, light.intensity * 1.15),
            roughness: 0.35,
            side: THREE.DoubleSide,
            toneMapped: false,
          });
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(light.width, light.height), panelMaterial);
          panel.position.copy(handle.position);
          panel.rotation.copy(handle.rotation);
          panel.scale.set(Math.max(0.05, light.transform.scaleX), Math.max(0.05, light.transform.scaleY), 1);
          panel.userData.virtualSetKind = 'light';
          panel.userData.virtualSetId = light.id;
          panel.userData.virtualSetLightRole = 'panel';
          binding.panel = panel;
          root.add(panel);
        }
        if (actual) {
          actual.userData.virtualSetKind = 'light';
          actual.userData.virtualSetId = light.id;
          binding.actual = actual;
          root.add(actual);
          syncLiveLight(light.id);
        }
      });

      updateGizmoAttachment();
      onViewportError?.(null);
    } catch (error) {
      onViewportError?.(error instanceof Error ? error.message : 'Could not prepare the Three.js path-traced scene.');
    }
  }, [clearScene, rebuildKey, syncLiveLight, updateGizmoAttachment]);

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      aria-label="Virtual Set Three.js viewport"
      className="h-full min-h-[420px] w-full bg-[#0b0d10] outline-none"
    />
  );
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
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderState, setRenderState] = useState<VirtualSetRenderState>('preview');
  const [error, setError] = useState<string | null>(null);
  const [viewportError, setViewportError] = useState<string | null>(null);
  const [renderFormat, setRenderFormat] = useState<RenderFormat>('png');
  const [renderSize, setRenderSize] = useState(renderSizes[3]);
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('objects');
  const [assetTab, setAssetTab] = useState<AssetTab>('models');
  const [assetSearch, setAssetSearch] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [renderPreset, setRenderPreset] = useState('ultra');
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [savedView, setSavedView] = useState<VirtualSetCamera | null>(null);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const viewportRef = useRef<VirtualSetViewportHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skyInputRef = useRef<HTMLInputElement | null>(null);
  const textureInputRef = useRef<HTMLInputElement | null>(null);
  const textureSlotRef = useRef<TextureSlot>('textureAssetId');
  const cancelRenderRef = useRef(false);
  const hasLoadedProjectRef = useRef(false);
  const undoStackRef = useRef<VirtualSetScene[]>([]);
  const redoStackRef = useRef<VirtualSetScene[]>([]);

  const selectedObject = useMemo(
    () => scene.objects.find((object) => object.id === scene.selectedObjectId) || null,
    [scene.objects, scene.selectedObjectId],
  );
  const selectedLight = useMemo(
    () => scene.lights.find((light) => light.id === selectedLightId) || null,
    [scene.lights, selectedLightId],
  );
  const skyAsset = useMemo(
    () => assetById(scene, scene.environment.hdriAssetId),
    [scene, scene.environment.hdriAssetId],
  );

  const saveSceneToProject = useCallback((targetProject: Project, nextScene: VirtualSetScene) => {
    const virtualSet = {
      ...(targetProject.state?.virtualSet || {}),
      activeSceneId: nextScene.id,
      scenes: [nextScene],
    };
    onUpdateProject({
      ...targetProject,
      lastModified: Date.now(),
      state: {
        ...(targetProject.state || {}),
        virtualSet,
      },
    });
  }, [onUpdateProject]);

  useEffect(() => {
    const projectScene = project?.state?.virtualSet?.scenes?.[0] as VirtualSetScene | undefined;
    setScene(normalizeScene(projectScene));
    setSelectedLightId(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    hasLoadedProjectRef.current = true;
  }, [project?.id]);

  useEffect(() => {
    if (!project || !hasLoadedProjectRef.current) return;
    const timer = window.setTimeout(() => saveSceneToProject(project, scene), 650);
    return () => window.clearTimeout(timer);
  }, [project, saveSceneToProject, scene]);

  const updateScene = useCallback((updater: (current: VirtualSetScene) => VirtualSetScene, options: { history?: boolean } = {}) => {
    setScene((current) => {
      const next = { ...updater(current), updatedAt: Date.now() };
      if (options.history !== false) {
        undoStackRef.current = [...undoStackRef.current.slice(-59), cloneScene(current)];
        redoStackRef.current = [];
      }
      return next;
    });
  }, []);

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

  const updateSelectedObject = (updater: (object: VirtualSetObject) => VirtualSetObject) => {
    if (!selectedObject) return;
    updateScene((current) => ({
      ...current,
      objects: current.objects.map((object) => object.id === selectedObject.id ? updater(object) : object),
    }));
  };

  const updateSelectedLight = (updater: (light: VirtualSetLight) => VirtualSetLight) => {
    if (!selectedLight) return;
    updateScene((current) => ({
      ...current,
      lights: current.lights.map((light) => light.id === selectedLight.id ? updater(light) : light),
    }));
  };

  const selectedBaseHeight = (object: VirtualSetObject) => {
    if (object.type === 'platform') return 0.36;
    if (object.type === 'sphere') return 1.5;
    if (object.type === 'cylinder') return 1.3;
    if (object.type === 'wall') return 2.8;
    if (object.type === 'backdrop') return 3.2;
    if (object.type === 'image-plane' || object.type === 'plane') return 2.7;
    if (object.type === 'model') return 1.8;
    return 1.35;
  };

  const updateSelectedTransform = (updater: (transform: VirtualSetTransform, object: VirtualSetObject) => VirtualSetTransform) => {
    updateSelectedObject((object) => ({ ...object, transform: updater(object.transform, object) }));
  };

  const focusSelected = () => {
    viewportRef.current?.focusObject(selectedObject?.id || selectedLight?.id || null);
  };

  const alignSelectedToFloor = () => {
    if (!selectedObject) return;
    updateSelectedTransform((transform, object) => ({
      ...transform,
      y: object.type === 'platform' ? -0.18 : (selectedBaseHeight(object) * Math.abs(transform.scaleY)) / 2,
    }));
  };

  const centerSelected = () => {
    updateSelectedTransform((transform) => ({ ...transform, x: 0, z: 0 }));
  };

  const resetSelectedTransform = () => {
    if (!selectedObject) return;
    updateSelectedObject((object) => ({ ...object, transform: createObject(object.type, 1).transform }));
  };

  const mirrorSelected = (axis: 'x' | 'y' | 'z') => {
    const key = axis === 'x' ? 'scaleX' : axis === 'y' ? 'scaleY' : 'scaleZ';
    updateSelectedTransform((transform) => ({ ...transform, [key]: transform[key] * -1 }));
  };

  const toggleSelectedLock = () => {
    updateSelectedObject((object) => ({ ...object, locked: !object.locked }));
  };

  const toggleSelectedVisibility = () => {
    updateSelectedObject((object) => ({ ...object, visible: !object.visible }));
  };

  const commitViewportTransform = useCallback((objectId: string, transform: VirtualSetTransform) => {
    updateScene((current) => ({
      ...current,
      objects: current.objects.map((object) => object.id === objectId ? { ...object, transform } : object),
    }));
  }, [updateScene]);

  const commitLightTransform = useCallback((lightId: string, transform: VirtualSetTransform) => {
    updateScene((current) => ({
      ...current,
      lights: current.lights.map((light) => light.id === lightId ? { ...light, transform } : light),
    }));
  }, [updateScene]);

  const commitCameraState = useCallback((camera: VirtualSetCamera) => {
    updateScene((current) => ({
      ...current,
      camera: { ...current.camera, ...camera },
    }), { history: false });
  }, [updateScene]);

  const undoScene = useCallback(() => {
    setScene((current) => {
      const previous = undoStackRef.current.pop();
      if (!previous) return current;
      redoStackRef.current = [...redoStackRef.current.slice(-59), cloneScene(current)];
      return { ...previous, updatedAt: Date.now() };
    });
  }, []);

  const redoScene = useCallback(() => {
    setScene((current) => {
      const next = redoStackRef.current.pop();
      if (!next) return current;
      undoStackRef.current = [...undoStackRef.current.slice(-59), cloneScene(current)];
      return { ...next, updatedAt: Date.now() };
    });
  }, []);

  const addObject = (type: VirtualSetObjectType, options: { image?: ImageState | null; assetId?: string | null } = {}) => {
    setInspectorTab('objects');
    updateScene((current) => {
      const object = createObject(type, current.objects.length + 1, options);
      object.transform.x = (current.objects.length % 4) - 1.5;
      setSelectedLightId(null);
      return {
        ...current,
        selectedObjectId: object.id,
        objects: [...current.objects, object],
      };
    });
  };

  const addLight = (type: VirtualSetLightType, label?: string) => {
    setInspectorTab('lights');
    updateScene((current) => {
      const light = createLight(type, current.lights.length + 1);
      if (label) light.name = label;
      light.transform.x += (current.lights.length % 3) - 1;
      setSelectedLightId(light.id);
      return {
        ...current,
        selectedObjectId: null,
        lights: [...current.lights, light],
      };
    });
  };

  const duplicateSelected = () => {
    if (selectedObject) {
      updateScene((current) => {
        const duplicate = cloneScene({ ...current, objects: [selectedObject] }).objects[0];
        duplicate.id = id(selectedObject.type);
        duplicate.name = `${selectedObject.name} copy`;
        duplicate.transform = { ...duplicate.transform, x: duplicate.transform.x + 0.35, z: duplicate.transform.z + 0.35 };
        return { ...current, selectedObjectId: duplicate.id, objects: [...current.objects, duplicate] };
      });
    } else if (selectedLight) {
      updateScene((current) => {
        const duplicate = { ...selectedLight, id: id(`light-${selectedLight.type}`), name: `${selectedLight.name} copy`, transform: { ...selectedLight.transform, x: selectedLight.transform.x + 0.35 } };
        setSelectedLightId(duplicate.id);
        return { ...current, lights: [...current.lights, duplicate] };
      });
    }
  };

  const deleteSelected = () => {
    if (selectedObject) {
      updateScene((current) => ({
        ...current,
        selectedObjectId: null,
        objects: current.objects.filter((object) => object.id !== selectedObject.id),
      }));
    } else if (selectedLight) {
      updateScene((current) => ({
        ...current,
        lights: current.lights.filter((light) => light.id !== selectedLight.id),
      }));
      setSelectedLightId(null);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) redoScene();
          else undoScene();
        }
        if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redoScene();
        }
        if (event.key.toLowerCase() === 'd') {
          event.preventDefault();
          duplicateSelected();
        }
      }
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redoScene, selectedLight, selectedObject, undoScene]);

  const handleAssetImport = async (fileList: FileList | File[] | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    try {
      const modelFiles = files.filter(isModelFile);
      if (modelFiles.length > 0) {
        const importedAssets = await Promise.all(modelFiles.map(async (modelFile) => {
          const dataUrl = await readFileAsDataUrl(modelFile);
          const sidecarFiles = files.filter((file) => file !== modelFile && !isModelFile(file));
          const resources = await Promise.all(sidecarFiles.map(async (resourceFile) => ({
            fileName: resourceFile.name,
            mimeType: resourceFile.type || 'application/octet-stream',
            dataUrl: await readFileAsDataUrl(resourceFile),
          })));
          return {
            id: id('model-asset'),
            type: 'model' as const,
            name: modelFile.name.replace(/\.[^/.]+$/, ''),
            fileName: modelFile.name,
            mimeType: modelMimeType(modelFile),
            dataUrl,
            resources,
          } satisfies VirtualSetAsset;
        }));

        updateScene((current) => {
          const newObjects = importedAssets.map((asset, index) => {
            const object = createObject('model', current.objects.length + index + 1, { assetId: asset.id });
            object.name = asset.name;
            object.transform.x = ((current.objects.length + index) % 4) - 1.5;
            object.transform.z = 0.15 + Math.floor(index / 4) * 0.35;
            return object;
          });
          setSelectedLightId(null);
          return {
            ...current,
            assets: [...current.assets, ...importedAssets],
            selectedObjectId: newObjects.at(-1)?.id || current.selectedObjectId,
            objects: [...current.objects, ...newObjects],
          };
        });
        return;
      }

      const importedImages = await Promise.all(files.filter((file) => file.type.startsWith('image/')).map(async (file) => {
        const dataUrl = await readFileAsDataUrl(file);
        const size = await imageSizeFromDataUrl(dataUrl);
        const image = imageStateFromDataUrl(dataUrl, file.name, size.width, size.height);
        return {
          image,
          asset: {
            id: id('image-asset'),
            type: 'image' as const,
            name: file.name.replace(/\.[^/.]+$/, ''),
            fileName: file.name,
            mimeType: image.mimeType || file.type || 'image/png',
            dataUrl,
            width: size.width,
            height: size.height,
          } satisfies VirtualSetAsset,
        };
      }));

      if (importedImages.length === 0) {
        throw new Error('Choose a GLB, GLTF, OBJ, or image file to import.');
      }

      updateScene((current) => {
        const newObjects = importedImages.map(({ image, asset }, index) => {
          const object = createObject('image-plane', current.objects.length + index + 1, { image, assetId: asset.id });
          object.transform.x = ((current.objects.length + index) % 4) - 1.5;
          return object;
        });
        setSelectedLightId(null);
        return {
          ...current,
          assets: [...current.assets, ...importedImages.map(({ asset }) => asset)],
          selectedObjectId: newObjects.at(-1)?.id || current.selectedObjectId,
          objects: [...current.objects, ...newObjects],
        };
      });
    } catch (assetError) {
      setError(assetError instanceof Error ? assetError.message : 'Could not import that asset.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleTextureImport = async (file: File | null) => {
    if (!file || !selectedObject) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const size = await imageSizeFromDataUrl(dataUrl);
      const asset: VirtualSetAsset = {
        id: id('texture-asset'),
        type: 'texture',
        name: file.name.replace(/\.[^/.]+$/, ''),
        fileName: file.name,
        mimeType: file.type || 'image/png',
        dataUrl,
        width: size.width,
        height: size.height,
      };
      const slot = textureSlotRef.current;
      updateScene((current) => ({
        ...current,
        assets: [...current.assets, asset],
        objects: current.objects.map((object) => object.id === selectedObject.id
          ? { ...object, material: { ...object.material, [slot]: asset.id } }
          : object),
      }));
    } catch (textureError) {
      setError(textureError instanceof Error ? textureError.message : 'Could not import that texture.');
    } finally {
      if (textureInputRef.current) textureInputRef.current.value = '';
    }
  };

  const handleSkyImport = async (file: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const size = await imageSizeFromDataUrl(dataUrl);
      const asset: VirtualSetAsset = {
        id: id('sky-asset'),
        type: 'environment',
        name: file.name.replace(/\.[^/.]+$/, ''),
        fileName: file.name,
        mimeType: file.type || 'image/png',
        dataUrl,
        width: size.width,
        height: size.height,
      };
      updateScene((current) => ({
        ...current,
        assets: [...current.assets, asset],
        environment: {
          ...current.environment,
          hdriAssetId: asset.id,
          ambientIntensity: Math.max(current.environment.ambientIntensity, 0.85),
          reflectionIntensity: Math.max(current.environment.reflectionIntensity, 1.15),
        },
      }));
      setInspectorTab('world');
    } catch (skyError) {
      setError(skyError instanceof Error ? skyError.message : 'Could not load that sky sphere image.');
    } finally {
      if (skyInputRef.current) skyInputRef.current.value = '';
    }
  };

  const removeSkySphere = () => {
    updateScene((current) => ({
      ...current,
      environment: {
        ...current.environment,
        hdriAssetId: null,
        ambientIntensity: 0,
        reflectionIntensity: 0,
      },
    }));
  };

  const openTexturePicker = (slot: TextureSlot) => {
    textureSlotRef.current = slot;
    textureInputRef.current?.click();
  };

  const clearTextureSlot = (slot: TextureSlot) => {
    updateSelectedObject((object) => ({
      ...object,
      material: { ...object.material, [slot]: null },
    }));
  };

  const downloadTextureSlot = (slot: TextureSlot) => {
    if (!selectedObject) return;
    const assetIdValue = selectedObject.material[slot];
    const asset = assetById(scene, assetIdValue);
    if (!asset?.dataUrl) return;
    downloadDataUrl(asset.dataUrl, asset.fileName);
  };

  const handleRender = async (mode: RenderMode, sendToReference = false) => {
    setError(null);
    cancelRenderRef.current = false;
    const targetProject = await ensureProject(scene);
    if (!targetProject) return;
    setIsRendering(true);
    setRenderProgress(0);
    setRenderState(mode === 'beauty' ? 'converging' : 'preview');
    try {
      const dataUrl = await viewportRef.current?.capture({
        format: renderFormat,
        width: renderSize.width,
        height: renderSize.height,
        mode,
        samples: mode === 'beauty' ? scene.rendererSettings.samples : 1,
        bounces: scene.rendererSettings.bounces,
        filterGlossyFactor: scene.rendererSettings.filterGlossyFactor,
        isCanceled: () => cancelRenderRef.current,
        onProgress: (progress, state) => {
          setRenderProgress(progress);
          setRenderState(state);
        },
      });
      if (!dataUrl) {
        setRenderState('canceled');
        return;
      }
      const mimeType = `image/${renderFormat}`;
      const render: VirtualSetRender = {
        id: id('render'),
        name: `${scene.name} ${mode === 'beauty' ? 'Beauty Render' : 'Preview'} ${new Date().toLocaleTimeString()}`,
        dataUrl,
        mimeType,
        width: renderSize.width,
        height: renderSize.height,
        createdAt: Date.now(),
        mode,
        samples: mode === 'beauty' ? scene.rendererSettings.samples : 1,
      };
      const nextScene = { ...scene, renders: [render, ...scene.renders].slice(0, 24), updatedAt: Date.now() };
      setScene(nextScene);
      saveSceneToProject(targetProject, nextScene);
      await saveVirtualSetRender({
        projectId: targetProject.id,
        scene: nextScene,
        dataUrl,
        name: render.name,
        width: render.width,
        height: render.height,
        format: renderFormat,
      });
      if (sendToReference) {
        onUseRender(imageStateFromDataUrl(dataUrl, `${render.name}.${renderFormat === 'jpeg' ? 'jpg' : renderFormat}`, render.width, render.height), 'reference');
      }
      setRenderState('saved');
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : 'Virtual Set render failed.');
      setRenderState('preview');
    } finally {
      setIsRendering(false);
      setRenderProgress(0);
    }
  };

  const cancelRender = () => {
    cancelRenderRef.current = true;
  };

  const useRender = (render: VirtualSetRender, mode: 'reference' | 'background') => {
    onUseRender(imageStateFromDataUrl(render.dataUrl, `${render.name}.${render.mimeType.includes('jpeg') ? 'jpg' : render.mimeType.split('/').pop() || 'png'}`, render.width, render.height), mode);
  };

  const sendViewportToReference = async () => {
    try {
      const dataUrl = await viewportRef.current?.capture({
        format: 'png',
        width: renderSize.width,
        height: renderSize.height,
        mode: 'preview',
        samples: 1,
        bounces: scene.rendererSettings.bounces,
        filterGlossyFactor: scene.rendererSettings.filterGlossyFactor,
      });
      if (!dataUrl) throw new Error('Viewport capture is not available yet.');
      onUseRender(imageStateFromDataUrl(dataUrl, `${scene.name}-viewport-reference.png`, renderSize.width, renderSize.height), 'reference');
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Could not send the viewport to Reference Edit.');
    }
  };

  const updateRendererSetting = <K extends keyof VirtualSetRendererSettings>(key: K, value: VirtualSetRendererSettings[K]) => {
    setRenderPreset('custom');
    updateScene((current) => ({
      ...current,
      rendererSettings: { ...current.rendererSettings, [key]: value, previewQuality: 'ultra' },
    }));
  };

  const applyRenderPreset = (presetId: string) => {
    const preset = renderPresetCards.find((item) => item.id === presetId);
    if (!preset) return;
    setRenderPreset(preset.id);
    if (preset.size) {
      const size = renderSizes.find((item) => item.label === preset.size);
      if (size) setRenderSize(size);
    }
    updateScene((current) => ({
      ...current,
      rendererSettings: {
        ...current.rendererSettings,
        ...preset.settings,
        previewQuality: 'ultra',
      },
    }));
  };

  const saveCurrentScene = async () => {
    const targetProject = await ensureProject(scene);
    if (!targetProject) return;
    saveSceneToProject(targetProject, { ...scene, updatedAt: Date.now() });
  };

  const viewRender = (render: VirtualSetRender) => {
    const view = window.open('', '_blank');
    if (!view) {
      downloadDataUrl(render.dataUrl, `${render.name}.${render.mimeType.includes('jpeg') ? 'jpg' : render.mimeType.split('/').pop() || 'png'}`);
      return;
    }
    view.document.write(`<title>${render.name}</title><body style="margin:0;background:#050505;display:grid;place-items:center;min-height:100vh"><img src="${render.dataUrl}" style="max-width:100%;max-height:100vh;object-fit:contain"/></body>`);
    view.document.close();
  };

  const updateEnvironment = <K extends keyof VirtualSetEnvironment>(key: K, value: VirtualSetEnvironment[K]) => {
    updateScene((current) => ({
      ...current,
      environment: { ...current.environment, [key]: value },
      lighting: key === 'skyPreset' ? { ...current.lighting, skyPreset: value as VirtualSetSkyPreset } : current.lighting,
    }));
  };

  const matchesAssetSearch = (label: string) => {
    const query = assetSearch.trim().toLowerCase();
    return query.length === 0 || label.toLowerCase().includes(query);
  };

  const applyMaterialPreset = (preset: VirtualSetMaterialPreset) => {
    if (!selectedObject) return;
    updateSelectedObject((object) => ({
      ...object,
      material: materialFromPreset(preset, {
        textureAssetId: object.material.textureAssetId,
        normalAssetId: object.material.normalAssetId,
        roughnessAssetId: object.material.roughnessAssetId,
        metalnessAssetId: object.material.metalnessAssetId,
      }),
    }));
  };

  const applySkyPreset = (skyPreset: VirtualSetSkyPreset) => {
    updateScene((current) => ({
      ...current,
      environment: {
        ...defaultEnvironment(skyPreset),
        ambientIntensity: current.environment.ambientIntensity || 0.78,
        reflectionIntensity: current.environment.reflectionIntensity || 1.12,
        showBackground: current.environment.showBackground !== false,
        hdriAssetId: current.environment.hdriAssetId,
      },
    }));
  };

  const applyCameraPreset = (presetId: string) => {
    const preset = cameraPresets.find((item) => item.id === presetId);
    if (!preset) return;
    updateScene((current) => ({
      ...current,
      camera: {
        ...current.camera,
        focalLength: preset.focalLength,
        x: preset.position.x,
        y: preset.position.y,
        z: preset.position.z,
        targetX: preset.target.x,
        targetY: preset.target.y,
        targetZ: preset.target.z,
      },
    }), { history: false });
  };

  const saveCurrentView = () => {
    setSavedView(scene.camera);
  };

  const returnToSavedView = () => {
    if (!savedView) return;
    updateScene((current) => ({ ...current, camera: { ...current.camera, ...savedView } }), { history: false });
  };

  const resetCameraView = () => {
    updateScene((current) => ({
      ...current,
      camera: {
        ...current.camera,
        ...defaultCamera(),
        moveSpeed: current.camera.moveSpeed,
        focalLength: current.camera.focalLength,
        aperture: current.camera.aperture,
        focusDistance: current.camera.focusDistance,
      },
    }), { history: false });
  };

  const renderPercent = Math.round(renderProgress * 100);
  const renderPresetLabel = renderPreset === 'custom'
    ? 'Custom'
    : renderPresetCards.find((preset) => preset.id === renderPreset)?.label || 'Ultra';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#07080A]">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hidden">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--color-accent)]">Virtual Set Studio</p>
            <h1 className="mt-2 text-2xl font-black text-[var(--color-text)]">Three.js path-traced renderer.</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
              Build a set in the fast viewport, then use Beauty Render for bounced light, soft shadows, and realistic reflections.
            </p>
          </div>

          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold text-[var(--color-text)]">Render Engine</p>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  {renderState === 'saved' ? 'Saved to project' : renderState === 'converging' ? `Path tracing ${renderPercent}%` : 'Three.js preview + path traced stills'}
                </p>
              </div>
              <span className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-[10px] font-black uppercase text-[var(--color-accent)]">Three.js</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${isRendering ? renderPercent : 100}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => handleRender('preview')} disabled={isRendering} className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-xs disabled:opacity-50">
                <ZapIcon className="h-3.5 w-3.5" />
                Preview Render
              </button>
              <button type="button" onClick={() => handleRender('beauty')} disabled={isRendering} className="primary-cta inline-flex items-center justify-center gap-2 px-3 py-2 text-xs disabled:opacity-50">
                <SparklesIcon className="h-3.5 w-3.5" />
                Beauty Render
              </button>
              {isRendering && (
                <button type="button" onClick={cancelRender} className="btn-secondary col-span-2 px-3 py-2 text-xs text-red-200">
                  Cancel Render
                </button>
              )}
            </div>
            <button type="button" onClick={sendViewportToReference} disabled={isRendering} className="btn-secondary mt-2 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs disabled:opacity-50">
              <SendIcon className="h-3.5 w-3.5" />
              Send View to Reference
            </button>
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
                <UploadIcon className="h-3.5 w-3.5" />
                Import Image or 3D Asset
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.glb,.gltf,.fbx,.obj,.bin,.mtl,.ktx2,.basis,.hdr,model/gltf-binary,model/gltf+json,model/fbx,model/obj,text/plain,application/octet-stream"
                className="hidden"
                onChange={(event) => handleAssetImport(event.target.files || null)}
              />
              <input ref={skyInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleSkyImport(event.target.files?.[0] || null)} />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-black uppercase tracking-[0.16em] text-[var(--color-text-muted)]">Add Lights</h2>
            <div className="grid grid-cols-2 gap-2">
              {lightTools.map((tool) => (
                <button key={tool.id} type="button" onClick={() => addLight(tool.type, tool.label)} className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-xs">
                  <LightbulbIcon className="h-3.5 w-3.5" />
                  {tool.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="relative min-h-[560px] flex-1 overflow-hidden bg-[#111317]">
          <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_50%_10%,rgba(186,255,41,0.08),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_28%)]" />

          {toolsOpen ? (
            <div className={`absolute ${libraryOpen ? 'bottom-[300px]' : 'bottom-5'} left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-[24px] border border-white/10 bg-black/65 px-3 py-2 shadow-2xl backdrop-blur-xl`}>
            {([
              ['translate', Move3DIcon, 'Move'],
              ['rotate', Rotate3DIcon, 'Rotate'],
              ['scale', ScalingIcon, 'Scale'],
            ] as const).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTransformMode(mode)}
                className={`grid min-w-16 place-items-center gap-1 rounded-2xl px-3 py-2 text-xs font-bold transition ${transformMode === mode ? 'bg-[var(--color-accent)] text-black shadow-[0_0_24px_rgba(186,255,41,0.22)]' : 'text-white/80 hover:bg-white/10'}`}
                title={`${label} selected item`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSnapToGrid((value) => !value)}
              className={`grid min-w-16 place-items-center gap-1 rounded-2xl px-3 py-2 text-xs font-bold transition ${snapToGrid ? 'bg-sky-400 text-black shadow-[0_0_24px_rgba(56,189,248,0.22)]' : 'text-white/80 hover:bg-white/10'}`}
              title="Snap transforms to the starter grid"
            >
              <Grid3X3Icon className="h-5 w-5" />
              Snap
            </button>
            <div className="mx-1 h-11 w-px bg-white/10" />
            <button type="button" onClick={focusSelected} disabled={!selectedObject && !selectedLight} className="grid min-w-16 place-items-center gap-1 rounded-2xl px-3 py-2 text-xs font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-35" title="Focus selected item">
              <FocusIcon className="h-5 w-5" />
              Focus
            </button>
            <button type="button" onClick={resetCameraView} className="grid min-w-16 place-items-center gap-1 rounded-2xl px-3 py-2 text-xs font-bold text-white/80 transition hover:bg-white/10" title="Reset camera">
              <Redo2Icon className="h-5 w-5" />
              View
            </button>
            <button type="button" onClick={() => handleRender('beauty', true)} disabled={isRendering} className="grid min-w-20 place-items-center gap-1 rounded-2xl px-3 py-2 text-xs font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50" title="Render and send to Reference Edit">
              <SendIcon className="h-5 w-5" />
              Reference
            </button>
            <button type="button" onClick={() => setToolsOpen(false)} className="grid min-w-12 place-items-center gap-1 rounded-2xl px-3 py-2 text-xs font-bold text-white/55 transition hover:bg-white/10" title="Collapse toolbar">
              <EyeOffIcon className="h-5 w-5" />
              Hide
            </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setToolsOpen(true)}
              className="absolute bottom-5 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/10 bg-black/65 px-4 py-3 text-sm font-black text-white shadow-2xl backdrop-blur-xl transition hover:border-[var(--color-accent)]/40 hover:bg-white/[0.08]"
            >
              <Move3DIcon className="h-4 w-4 text-[var(--color-accent)]" />
              Tools
            </button>
          )}

          {(selectedObject || selectedLight) && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="absolute left-1/2 top-20 z-30 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-3 py-2 shadow-2xl backdrop-blur-xl"
            >
              <span className="max-w-[220px] truncate px-2 text-xs font-black text-white">{selectedObject?.name || selectedLight?.name}</span>
              <button type="button" onClick={duplicateSelected} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.08] text-white transition hover:bg-[var(--color-accent)] hover:text-black" title="Duplicate">
                <CopyIcon className="h-4 w-4" />
              </button>
              <button type="button" onClick={selectedObject ? toggleSelectedLock : undefined} disabled={!selectedObject} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.08] text-white transition hover:bg-white/[0.14] disabled:opacity-35" title={selectedObject?.locked ? 'Unlock' : 'Lock'}>
                {selectedObject?.locked ? <LockIcon className="h-4 w-4 text-amber-200" /> : <UnlockIcon className="h-4 w-4" />}
              </button>
              <button type="button" onClick={selectedObject ? toggleSelectedVisibility : undefined} disabled={!selectedObject} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.08] text-white transition hover:bg-white/[0.14] disabled:opacity-35" title={selectedObject?.visible === false ? 'Show' : 'Hide'}>
                {selectedObject?.visible === false ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </button>
              <button type="button" onClick={deleteSelected} className="grid h-9 w-9 place-items-center rounded-xl bg-red-500/15 text-red-100 transition hover:bg-red-500/25" title="Delete">
                <Trash2Icon className="h-4 w-4" />
              </button>
            </motion.div>
          )}

          {libraryOpen ? (
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="absolute bottom-5 left-1/2 z-20 w-[min(860px,calc(100%-2.5rem))] -translate-x-1/2 rounded-[26px] border border-white/10 bg-black/60 p-3 shadow-2xl backdrop-blur-2xl"
            >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <div>
                <p className="text-sm font-black text-white">Creative Library</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">Add models, lights, materials, and skies only when you need them.</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={assetSearch}
                  onChange={(event) => setAssetSearch(event.target.value)}
                  placeholder="Search chairs, lights, clouds..."
                  className="h-9 w-56 rounded-xl border border-white/10 bg-white/[0.07] px-3 text-xs font-bold text-white placeholder:text-white/35"
                />
                <button type="button" onClick={() => setLibraryOpen(false)} className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 text-xs font-extrabold text-white transition hover:bg-white/[0.12]">
                  Hide
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 text-xs font-extrabold text-white transition hover:bg-white/[0.12]">
                  Import
                </button>
              </div>
            </div>

            <div className="mb-3 flex gap-2 overflow-x-auto custom-scrollbar">
              {assetTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAssetTab(tab.id)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-black transition ${assetTab === tab.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-black' : 'border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08]'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex min-h-[92px] gap-3 overflow-x-auto pb-1 custom-scrollbar">
              {assetTab === 'models' && objectTools.filter((tool) => ['cube', 'sphere', 'cylinder'].includes(tool.type)).filter((tool) => matchesAssetSearch(tool.label)).map((tool) => (
                <button key={tool.type} type="button" onClick={() => addObject(tool.type)} className="group flex h-[88px] min-w-[136px] flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50 hover:bg-white/[0.09]">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.08] text-white group-hover:bg-[var(--color-accent)] group-hover:text-black">{tool.icon}</span>
                  <span className="text-sm font-extrabold text-white">{tool.label}</span>
                </button>
              ))}
              {assetTab === 'models' && matchesAssetSearch('Import custom 3D asset') && (
                <button type="button" onClick={() => fileInputRef.current?.click()} className="group flex h-[88px] min-w-[164px] flex-col justify-between rounded-2xl border border-dashed border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 p-3 text-left transition hover:-translate-y-0.5 hover:bg-[var(--color-accent)]/16">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-accent)] text-black"><UploadIcon className="h-4 w-4" /></span>
                  <span className="text-sm font-extrabold text-white">Import GLB / FBX / OBJ</span>
                </button>
              )}
              {assetTab === 'props' && objectTools.filter((tool) => ['platform', 'wall'].includes(tool.type)).filter((tool) => matchesAssetSearch(tool.label)).map((tool) => (
                <button key={tool.type} type="button" onClick={() => addObject(tool.type)} className="group flex h-[88px] min-w-[136px] flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50 hover:bg-white/[0.09]">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.08] text-white group-hover:bg-[var(--color-accent)] group-hover:text-black">{tool.icon}</span>
                  <span className="text-sm font-extrabold text-white">{tool.label}</span>
                </button>
              ))}
              {assetTab === 'backdrops' && objectTools.filter((tool) => ['backdrop', 'plane'].includes(tool.type)).filter((tool) => matchesAssetSearch(tool.label)).map((tool) => (
                <button key={tool.type} type="button" onClick={() => addObject(tool.type)} className="group flex h-[88px] min-w-[136px] flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50 hover:bg-white/[0.09]">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.08] text-white group-hover:bg-[var(--color-accent)] group-hover:text-black">{tool.icon}</span>
                  <span className="text-sm font-extrabold text-white">{tool.label}</span>
                </button>
              ))}
              {assetTab === 'lights' && lightTools.filter((tool) => matchesAssetSearch(tool.label)).map((tool) => (
                <button key={tool.id} type="button" onClick={() => addLight(tool.type, tool.label)} className="group flex h-[88px] min-w-[136px] flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50 hover:bg-white/[0.09]">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.08] text-white group-hover:bg-[var(--color-accent)] group-hover:text-black"><LightbulbIcon className="h-4 w-4" /></span>
                  <span className="text-sm font-extrabold text-white">{tool.label}</span>
                </button>
              ))}
              {assetTab === 'materials' && Object.entries(materialLabels).filter(([, label]) => matchesAssetSearch(label)).map(([preset, label]) => (
                <button key={preset} type="button" onClick={() => applyMaterialPreset(preset as VirtualSetMaterialPreset)} disabled={!selectedObject} className="group flex h-[88px] min-w-[144px] flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50 hover:bg-white/[0.09] disabled:opacity-40">
                  <span className="h-9 w-9 rounded-full border border-white/20 shadow-inner" style={{ background: materialPresets[preset as VirtualSetMaterialPreset].color }} />
                  <span className="text-sm font-extrabold text-white">{label}</span>
                </button>
              ))}
              {assetTab === 'hdris' && skyOptions.filter((sky) => matchesAssetSearch(sky.label)).map((sky) => (
                <button key={sky.id} type="button" onClick={() => applySkyPreset(sky.id)} className="group flex h-[88px] min-w-[136px] flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-white/[0.055] text-left transition hover:-translate-y-0.5 hover:border-[var(--color-accent)]/50 hover:bg-white/[0.09]">
                  <span className="block h-11 w-full" style={{ background: `linear-gradient(${sky.top}, ${sky.bottom})` }} />
                  <span className="px-3 pb-3 text-sm font-extrabold text-white">{sky.label}</span>
                </button>
              ))}
            </div>
            </motion.div>
          ) : (
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              className="absolute bottom-5 left-5 z-30 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/65 px-4 py-3 text-sm font-black text-white shadow-2xl backdrop-blur-xl transition hover:border-[var(--color-accent)]/40 hover:bg-white/[0.08]"
            >
              <LayersIcon className="h-4 w-4 text-[var(--color-accent)]" />
              Library
            </button>
          )}
          <VirtualSetViewport
            ref={viewportRef}
            sceneData={scene}
            selectedObjectId={scene.selectedObjectId}
            selectedLightId={selectedLightId}
            transformMode={transformMode}
            onSelectObject={(objectId) => {
              if (objectId) setInspectorTab('objects');
              if (objectId) setSelectedLightId(null);
              updateScene((current) => ({ ...current, selectedObjectId: objectId }), { history: false });
            }}
            onSelectLight={(lightId) => {
              if (lightId) setInspectorTab('lights');
              setSelectedLightId(lightId);
              if (lightId) updateScene((current) => ({ ...current, selectedObjectId: null }), { history: false });
            }}
            onObjectTransform={commitViewportTransform}
            onLightTransform={commitLightTransform}
            onCameraChange={commitCameraState}
            onViewportError={setViewportError}
            snapToGrid={snapToGrid}
          />
          {viewportError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0b0d10] p-6">
              <div className="max-w-md rounded-2xl border border-amber-400/25 bg-amber-400/10 p-5 text-center shadow-2xl backdrop-blur">
                <p className="text-sm font-black text-amber-100">Three.js renderer could not start</p>
                <p className="mt-2 text-sm leading-6 text-amber-100/80">
                  ISTUDIO could not initialize the native viewport. Turn on hardware acceleration or update the graphics driver, then restart ISTUDIO.
                </p>
                <p className="mt-3 rounded-lg bg-black/30 p-3 text-xs text-amber-50/80">{viewportError}</p>
              </div>
            </div>
          )}
          {error && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="absolute bottom-4 left-4 right-4 z-30 rounded-xl border border-red-400/20 bg-red-500/15 p-3 text-sm text-red-100 backdrop-blur">
              {error}
            </motion.div>
          )}
          {isRendering && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-40 grid place-items-center bg-black/35 p-6 backdrop-blur-sm">
              <motion.div initial={{ y: 18, scale: 0.96 }} animate={{ y: 0, scale: 1 }} className="w-[min(420px,100%)] overflow-hidden rounded-[28px] border border-white/10 bg-[#111419]/90 p-5 text-center shadow-2xl">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                  <SparklesIcon className="h-7 w-7" />
                </div>
                <h3 className="mt-4 text-lg font-black text-white">Creating your scene...</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                  Rendering the active camera with Ultra preview lighting, shadows, reflections, and effects.
                </p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${renderPercent}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between text-xs font-bold text-white/55">
                  <span>{renderState === 'saved' ? 'Saved' : renderState === 'converging' ? 'Rendering' : 'Preparing'}</span>
                  <span>{renderPercent}%</span>
                </div>
                <button type="button" onClick={cancelRender} className="btn-secondary mt-5 w-full px-3 py-2 text-xs text-red-100">
                  Cancel
                </button>
              </motion.div>
            </motion.div>
          )}
          {renderState === 'saved' && !isRendering && (
            <motion.div initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="absolute right-5 top-5 z-30 rounded-2xl border border-[var(--color-accent)]/25 bg-black/60 px-4 py-3 text-sm font-black text-[var(--color-accent)] shadow-2xl backdrop-blur-xl">
              Render saved to project
            </motion.div>
          )}
        </main>

        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 bg-[#090b0f]/95 p-4 shadow-2xl lg:w-[360px] lg:border-l lg:border-t-0 custom-scrollbar">
          <GlassPanel className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black text-white">Controls</p>
                <p className="mt-1 text-xs font-bold text-white/45">{selectedObject?.name || selectedLight?.name || 'Scene controls'}</p>
              </div>
              <span className="rounded-full bg-[var(--color-accent)] px-3 py-1 text-[10px] font-black uppercase text-black shadow-[0_0_22px_rgba(186,255,41,0.22)]">
                Scene Ready
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <span className="rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-white/75">Virtual Set</span>
              <span className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-sky-200">{renderPresetLabel}</span>
            </div>
          </GlassPanel>

          <GlassPanel className="p-3">
            <div className="grid grid-cols-2 gap-2">
              <ActionButton onClick={() => handleRender('beauty')} disabled={isRendering} variant="primary" icon={<SparklesIcon className="h-4 w-4" />}>
                Render
              </ActionButton>
              <ActionButton onClick={() => handleRender('beauty', true)} disabled={isRendering} icon={<SendIcon className="h-4 w-4" />}>
                Reference
              </ActionButton>
              <ActionButton onClick={saveCurrentScene} disabled={isRendering} icon={<SaveIcon className="h-4 w-4" />} className="col-span-2">
                Save Scene
              </ActionButton>
            </div>
          </GlassPanel>

          <GlassPanel className="grid grid-cols-4 gap-2 p-1.5">
            {[
              ['objects', PaletteIcon, 'Object'],
              ['lights', LightbulbIcon, 'Light'],
              ['world', SunIcon, 'World'],
              ['render', CameraIcon, 'Render'],
            ].map(([tab, Icon, label]) => (
              <button key={tab as string} type="button" onClick={() => setInspectorTab(tab as InspectorTab)} className={`rounded-2xl border px-2 py-3 text-[10px] font-black uppercase tracking-[0.08em] transition ${inspectorTab === tab ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-black shadow-[0_0_18px_rgba(186,255,41,0.16)]' : 'border-transparent bg-transparent text-white/45 hover:bg-white/[0.07]'}`}>
                <Icon className="mx-auto mb-1 h-4 w-4" />
                {label as string}
              </button>
            ))}
          </GlassPanel>

          <section className={`rounded-[24px] border border-white/10 bg-black/45 p-4 shadow-2xl shadow-black/25 backdrop-blur-2xl ${inspectorTab === 'objects' ? '' : 'hidden'}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <PaletteIcon className="h-4 w-4 text-[var(--color-accent)]" />
                <h2 className="text-sm font-black text-[var(--color-text)]">Object Properties</h2>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={duplicateSelected} disabled={!selectedObject && !selectedLight} className="btn-secondary p-2 disabled:opacity-40" title="Duplicate"><CopyIcon className="h-4 w-4" /></button>
                <button type="button" onClick={deleteSelected} disabled={!selectedObject && !selectedLight} className="btn-secondary p-2 text-red-200 disabled:opacity-40" title="Delete"><Trash2Icon className="h-4 w-4" /></button>
              </div>
            </div>
            {selectedObject ? (
              <div className="space-y-4">
                <p className="text-sm font-extrabold text-[var(--color-text)]">{selectedObject.name}</p>
                <select value={selectedObject.material.preset} onChange={(event) => updateSelectedObject((object) => ({
                  ...object,
                  material: materialFromPreset(event.target.value as VirtualSetMaterialPreset, {
                    color: object.material.color,
                    textureAssetId: object.material.textureAssetId,
                    normalAssetId: object.material.normalAssetId,
                    roughnessAssetId: object.material.roughnessAssetId,
                    metalnessAssetId: object.material.metalnessAssetId,
                  }),
                }))} className="w-full px-3 py-2 text-sm">
                  {Object.entries(materialLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <label className="space-y-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  Base Color
                  <input type="color" value={selectedObject.material.color} onChange={(event) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, color: event.target.value } }))} className="h-9 w-full rounded-lg border border-white/10 bg-transparent p-1" />
                </label>
                <NumberField label="Softness" value={selectedObject.material.roughness} min={0} max={1} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, roughness: value } }))} />
                <NumberField label="Shiny Metal" value={selectedObject.material.metallic} min={0} max={1} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, metallic: value } }))} />
                <NumberField label="Reflections" value={selectedObject.material.reflectionIntensity ?? 0.5} min={0} max={3} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, reflectionIntensity: value } }))} />
                <NumberField label="Specular" value={selectedObject.material.specularIntensity ?? 1} min={0} max={2} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, specularIntensity: value } }))} />
                <NumberField label="Opacity" value={selectedObject.material.opacity} min={0.02} max={1} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, opacity: value } }))} />
                <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Textures</p>
                  {selectedObject.type === 'model' && (
                    <p className="mb-3 rounded-lg border border-white/10 bg-black/20 p-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
                      Imported model textures are loaded from embedded data and selected sidecar files. Upload maps here to override the model material globally.
                    </p>
                  )}
                  {[
                    ['textureAssetId', 'Albedo'],
                    ['normalAssetId', 'Normal'],
                    ['roughnessAssetId', 'Roughness Map'],
                    ['metalnessAssetId', 'Metallic Map'],
                  ].map(([slot, label]) => {
                    const textureSlot = slot as TextureSlot;
                    const asset = assetById(scene, selectedObject.material[textureSlot]);
                    return (
                      <div key={slot} className="mb-2 last:mb-0 rounded-lg border border-white/10 bg-black/20 p-2">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-xs font-extrabold text-white">{label}</span>
                          <span className="min-w-0 truncate text-[10px] text-[var(--color-text-muted)]">{asset?.fileName || 'No map'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <button type="button" onClick={() => openTexturePicker(textureSlot)} className="btn-secondary px-2 py-1.5 text-[10px]">Upload</button>
                          <button type="button" onClick={() => downloadTextureSlot(textureSlot)} disabled={!asset} className="btn-secondary px-2 py-1.5 text-[10px] disabled:opacity-40">Download</button>
                          <button type="button" onClick={() => clearTextureSlot(textureSlot)} disabled={!asset} className="btn-secondary px-2 py-1.5 text-[10px] disabled:opacity-40">Clear</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <input ref={textureInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleTextureImport(event.target.files?.[0] || null)} />
                <details className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                  <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Advanced Material</summary>
                  <div className="mt-3 space-y-3">
                    <NumberField label="Clearcoat" value={selectedObject.material.clearcoat} min={0} max={1} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, clearcoat: value } }))} />
                    <NumberField label="Coat Roughness" value={selectedObject.material.clearcoatRoughness ?? 0.2} min={0} max={1} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, clearcoatRoughness: value } }))} />
                    <NumberField label="Transmission" value={selectedObject.material.transmission} min={0} max={1} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, transmission: value } }))} />
                    <NumberField label="IOR" value={selectedObject.material.ior ?? 1.5} min={1} max={2.5} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, ior: value } }))} />
                    <NumberField label="Thickness" value={selectedObject.material.thickness ?? 0} min={0} max={2} step={0.01} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, thickness: value } }))} />
                    <label className="space-y-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Emissive
                      <input type="color" value={selectedObject.material.emissive} onChange={(event) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, emissive: event.target.value } }))} className="h-9 w-full rounded-lg border border-white/10 bg-transparent p-1" />
                    </label>
                    <NumberField label="Glow Strength" value={selectedObject.material.emissiveIntensity} min={0} max={20} step={0.05} onChange={(value) => updateSelectedObject((object) => ({ ...object, material: { ...object.material, emissiveIntensity: value } }))} />
                  </div>
                </details>
                <div className="grid grid-cols-3 gap-2">
                  {(['x', 'y', 'z'] as const).map((key) => (
                    <NumberField key={key} label={key.toUpperCase()} value={selectedObject.transform[key]} min={-8} max={8} step={0.05} onChange={(value) => updateSelectedObject((object) => ({ ...object, transform: { ...object.transform, [key]: value } }))} />
                  ))}
                  {(['rotationX', 'rotationY', 'rotationZ'] as const).map((key) => (
                    <NumberField key={key} label={fieldLabel(key)} value={selectedObject.transform[key]} min={-180} max={180} step={1} onChange={(value) => updateSelectedObject((object) => ({ ...object, transform: { ...object.transform, [key]: value } }))} />
                  ))}
                  {(['scaleX', 'scaleY', 'scaleZ'] as const).map((key) => (
                    <NumberField key={key} label={fieldLabel(key)} value={selectedObject.transform[key]} min={0.1} max={5} step={0.05} onChange={(value) => updateSelectedObject((object) => ({ ...object, transform: { ...object.transform, [key]: value } }))} />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/[0.025] p-2">
                  <button type="button" onClick={alignSelectedToFloor} className="rounded-lg bg-white/[0.06] px-2 py-2 text-[10px] font-black text-white/75 transition hover:bg-white/[0.12]">Floor</button>
                  <button type="button" onClick={centerSelected} className="rounded-lg bg-white/[0.06] px-2 py-2 text-[10px] font-black text-white/75 transition hover:bg-white/[0.12]">Center</button>
                  <button type="button" onClick={resetSelectedTransform} className="rounded-lg bg-white/[0.06] px-2 py-2 text-[10px] font-black text-white/75 transition hover:bg-white/[0.12]">Reset</button>
                  <button type="button" onClick={() => mirrorSelected('x')} className="rounded-lg bg-white/[0.06] px-2 py-2 text-[10px] font-black text-white/75 transition hover:bg-white/[0.12]">Mirror X</button>
                  <button type="button" onClick={() => mirrorSelected('y')} className="rounded-lg bg-white/[0.06] px-2 py-2 text-[10px] font-black text-white/75 transition hover:bg-white/[0.12]">Mirror Y</button>
                  <button type="button" onClick={() => mirrorSelected('z')} className="rounded-lg bg-white/[0.06] px-2 py-2 text-[10px] font-black text-white/75 transition hover:bg-white/[0.12]">Mirror Z</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">Select an object to tune its material, transform, and path-traced light contribution.</p>
            )}
          </section>

          <section className={`rounded-[24px] border border-white/10 bg-black/45 p-4 shadow-2xl shadow-black/25 backdrop-blur-2xl ${inspectorTab === 'lights' ? '' : 'hidden'}`}>
            <div className="mb-4 flex items-center gap-2">
              <LightbulbIcon className="h-4 w-4 text-[var(--color-accent)]" />
              <h2 className="text-sm font-black text-[var(--color-text)]">Lights</h2>
            </div>
            <div className="mb-4 max-h-40 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {scene.lights.map((light) => (
                <button key={light.id} type="button" onClick={() => {
                  setSelectedLightId(light.id);
                  updateScene((current) => ({ ...current, selectedObjectId: null }), { history: false });
                }} className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left ${selectedLightId === light.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-white/10 bg-white/[0.035]'}`}>
                  <span className="truncate text-xs font-extrabold text-[var(--color-text)]">{light.name}</span>
                  <span className="h-3 w-3 rounded-full" style={{ background: light.color }} />
                </button>
              ))}
            </div>
            {selectedLight ? (
              <div className="space-y-3">
                <ToggleField label="Enabled" checked={selectedLight.enabled} onChange={(checked) => updateSelectedLight((light) => ({ ...light, enabled: checked }))} />
                <label className="space-y-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  Color
                  <input type="color" value={selectedLight.color} onChange={(event) => updateSelectedLight((light) => ({ ...light, color: event.target.value }))} className="h-9 w-full rounded-lg border border-white/10 bg-transparent p-1" />
                </label>
                <NumberField label="Intensity" value={selectedLight.intensity} min={0} max={30} step={0.05} onChange={(value) => updateSelectedLight((light) => ({ ...light, intensity: value }))} />
                <NumberField label="Temperature" value={selectedLight.temperature} min={2500} max={9000} step={100} onChange={(value) => updateSelectedLight((light) => ({ ...light, temperature: value }))} />
                <NumberField label="Softness" value={selectedLight.softness} min={0} max={5} step={0.05} onChange={(value) => updateSelectedLight((light) => ({ ...light, softness: value }))} />
                {(selectedLight.type === 'point' || selectedLight.type === 'spot') && (
                  <NumberField label="Range" value={selectedLight.range} min={0.5} max={30} step={0.1} onChange={(value) => updateSelectedLight((light) => ({ ...light, range: value }))} />
                )}
                {selectedLight.type === 'spot' && (
                  <>
                    <NumberField label="Cone Angle" value={selectedLight.angle} min={5} max={90} step={1} onChange={(value) => updateSelectedLight((light) => ({ ...light, angle: value }))} />
                    <NumberField label="Penumbra" value={selectedLight.penumbra} min={0} max={1} step={0.01} onChange={(value) => updateSelectedLight((light) => ({ ...light, penumbra: value }))} />
                  </>
                )}
                {(selectedLight.type === 'area' || selectedLight.type === 'panel') && (
                  <>
                    <NumberField label="Width" value={selectedLight.width} min={0.1} max={8} step={0.05} onChange={(value) => updateSelectedLight((light) => ({ ...light, width: value }))} />
                    <NumberField label="Height" value={selectedLight.height} min={0.1} max={8} step={0.05} onChange={(value) => updateSelectedLight((light) => ({ ...light, height: value }))} />
                  </>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <NumberField label="X" value={selectedLight.transform.x} min={-8} max={8} step={0.05} onChange={(value) => updateSelectedLight((light) => ({ ...light, transform: { ...light.transform, x: value } }))} />
                  <NumberField label="Y" value={selectedLight.transform.y} min={-1} max={8} step={0.05} onChange={(value) => updateSelectedLight((light) => ({ ...light, transform: { ...light.transform, y: value } }))} />
                  <NumberField label="Z" value={selectedLight.transform.z} min={-8} max={8} step={0.05} onChange={(value) => updateSelectedLight((light) => ({ ...light, transform: { ...light.transform, z: value } }))} />
                  <NumberField label="Pitch" value={selectedLight.transform.rotationX} min={-180} max={180} step={1} onChange={(value) => updateSelectedLight((light) => ({ ...light, transform: { ...light.transform, rotationX: value } }))} />
                  <NumberField label="Yaw" value={selectedLight.transform.rotationY} min={-180} max={180} step={1} onChange={(value) => updateSelectedLight((light) => ({ ...light, transform: { ...light.transform, rotationY: value } }))} />
                  <NumberField label="Roll" value={selectedLight.transform.rotationZ} min={-180} max={180} step={1} onChange={(value) => updateSelectedLight((light) => ({ ...light, transform: { ...light.transform, rotationZ: value } }))} />
                  <NumberField label="Scale X" value={selectedLight.transform.scaleX} min={0.1} max={5} step={0.05} onChange={(value) => updateSelectedLight((light) => ({ ...light, transform: { ...light.transform, scaleX: value } }))} />
                  <NumberField label="Scale Y" value={selectedLight.transform.scaleY} min={0.1} max={5} step={0.05} onChange={(value) => updateSelectedLight((light) => ({ ...light, transform: { ...light.transform, scaleY: value } }))} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">Select a light to tune its intensity, temperature, and position.</p>
            )}
          </section>

          <section className={`rounded-[24px] border border-white/10 bg-black/45 p-4 shadow-2xl shadow-black/25 backdrop-blur-2xl ${inspectorTab === 'world' ? '' : 'hidden'}`}>
            <div className="mb-4 flex items-center gap-2">
              <SunIcon className="h-4 w-4 text-[var(--color-accent)]" />
              <h2 className="text-sm font-black text-[var(--color-text)]">Environment</h2>
            </div>
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-white">Sky Sphere</p>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
                    {skyAsset ? skyAsset.fileName : 'Generated daylight sky sphere is active.'}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${scene.environment.hdriAssetId ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'bg-white/10 text-white/55'}`}>
                  {scene.environment.hdriAssetId ? 'On' : 'Off'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => skyInputRef.current?.click()} className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 text-xs font-extrabold text-white transition hover:bg-white/[0.12]">
                  Apply Sky Image
                </button>
                <button type="button" onClick={removeSkySphere} className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-extrabold text-white/75 transition hover:bg-white/[0.08]">
                  Dark World
                </button>
              </div>
            </div>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {cinematicLightingPresets.map((preset) => (
                <button key={preset.id} type="button" onClick={() => updateScene((current) => ({
                  ...current,
                  environment: {
                    ...defaultEnvironment(preset.sky),
                    ambientIntensity: preset.ambient,
                    reflectionIntensity: preset.reflection,
                    showBackground: current.environment.showBackground !== false,
                    hdriAssetId: current.environment.hdriAssetId,
                  },
                  rendererSettings: { ...current.rendererSettings, exposure: preset.exposure, previewQuality: 'ultra' },
                }))} className="rounded-lg border border-white/10 bg-white/[0.035] px-2 py-2 text-[10px] font-black text-white transition hover:border-[var(--color-accent)]/40 hover:bg-white/[0.08]">
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {skyOptions.map((sky) => (
                <button key={sky.id} type="button" onClick={() => updateScene((current) => ({ ...current, environment: { ...defaultEnvironment(sky.id), ambientIntensity: current.environment.ambientIntensity, reflectionIntensity: current.environment.reflectionIntensity, showBackground: current.environment.showBackground !== false, hdriAssetId: current.environment.hdriAssetId } }))} className={`rounded-lg border p-2 text-[10px] font-bold ${scene.environment.skyPreset === sky.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-white/10 bg-white/[0.035]'}`}>
                  <span className="mb-1 block h-4 rounded" style={{ background: `linear-gradient(${sky.top}, ${sky.bottom})` }} />
                  {sky.label}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-3">
              <p className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-[var(--color-text-muted)]">
                Sky Sphere image lighting feeds reflections and Beauty Render environment lighting. Use Dark World plus disabled sun/lights for a fully black scene.
              </p>
              <NumberField label="Sky Light" value={scene.environment.ambientIntensity} min={0} max={3} step={0.05} onChange={(value) => updateEnvironment('ambientIntensity', value)} />
              <NumberField label="Sky Reflections" value={scene.environment.reflectionIntensity} min={0} max={3} step={0.05} onChange={(value) => updateEnvironment('reflectionIntensity', value)} />
              <ToggleField label="Show Sky Background" checked={scene.environment.showBackground !== false} onChange={(checked) => updateEnvironment('showBackground', checked)} />
              <NumberField label="Fog" value={scene.environment.fog} min={0} max={1} step={0.01} onChange={(value) => updateEnvironment('fog', value)} />
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  Sky Top
                  <input type="color" value={scene.environment.backgroundTop} onChange={(event) => updateEnvironment('backgroundTop', event.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-transparent p-1" />
                </label>
                <label className="space-y-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                  Horizon
                  <input type="color" value={scene.environment.backgroundBottom} onChange={(event) => updateEnvironment('backgroundBottom', event.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-transparent p-1" />
                </label>
              </div>
            </div>
          </section>

          <div className={`space-y-3 ${inspectorTab === 'render' ? '' : 'hidden'}`}>
            <CollapsibleSection title="Render Quality" icon={<SparklesIcon className="h-4 w-4" />} defaultOpen>
              <div className="grid grid-cols-2 gap-2">
                {renderPresetCards.map((preset) => (
                  <PresetChip
                    key={preset.id}
                    label={preset.label}
                    description={preset.description}
                    active={renderPreset === preset.id}
                    onClick={() => applyRenderPreset(preset.id)}
                  />
                ))}
              </div>
              <SliderCard icon={<SparklesIcon className="h-4 w-4" />} label="Detail Quality" value={scene.rendererSettings.samples} min={8} max={512} step={8} onChange={(value) => updateRendererSetting('samples', value)} />
              <SliderCard icon={<SunIcon className="h-4 w-4" />} label="Light Depth" value={scene.rendererSettings.bounces} min={1} max={16} step={1} onChange={(value) => updateRendererSetting('bounces', value)} />
              <SliderCard icon={<SparklesIcon className="h-4 w-4" />} label="Sparkle Cleanup" value={scene.rendererSettings.filterGlossyFactor} min={0} max={1} step={0.01} onChange={(value) => updateRendererSetting('filterGlossyFactor', value)} />
              <SliderCard icon={<LayersIcon className="h-4 w-4" />} label="Shadow Detail" value={scene.rendererSettings.shadowQuality} min={512} max={4096} step={512} onChange={(value) => updateRendererSetting('shadowQuality', value)} />
            </CollapsibleSection>

            <CollapsibleSection title="Lighting" icon={<SunIcon className="h-4 w-4" />} defaultOpen>
              <div className="grid grid-cols-3 gap-2">
                {cinematicLightingPresets.map((preset) => (
                  <button key={preset.id} type="button" onClick={() => updateScene((current) => ({
                    ...current,
                    environment: {
                      ...defaultEnvironment(preset.sky),
                      ambientIntensity: preset.ambient,
                      reflectionIntensity: preset.reflection,
                      showBackground: current.environment.showBackground !== false,
                      hdriAssetId: current.environment.hdriAssetId,
                    },
                    rendererSettings: { ...current.rendererSettings, exposure: preset.exposure, previewQuality: 'ultra' },
                  }))} className="rounded-2xl border border-white/10 bg-white/[0.045] px-2 py-3 text-[10px] font-black text-white transition hover:border-[var(--color-accent)]/40 hover:bg-white/[0.08]">
                    {preset.label}
                  </button>
                ))}
              </div>
              <SliderCard icon={<SunIcon className="h-4 w-4" />} label="Exposure" value={scene.rendererSettings.exposure} min={0.2} max={2.5} step={0.05} onChange={(value) => updateRendererSetting('exposure', value)} />
              <SliderCard icon={<Grid3X3Icon className="h-4 w-4" />} label="Contact Shadow" value={scene.rendererSettings.ambientOcclusionIntensity} min={0} max={3} step={0.05} onChange={(value) => updateRendererSetting('ambientOcclusionIntensity', value)} />
            </CollapsibleSection>

            <CollapsibleSection title="Effects" icon={<ZapIcon className="h-4 w-4" />} defaultOpen>
              <ToggleCard icon={<Grid3X3Icon className="h-4 w-4" />} label="Ambient Occlusion" description="Adds grounded contact depth." checked={scene.rendererSettings.enableSSAO} onChange={(checked) => updateRendererSetting('enableSSAO', checked)} />
              <ToggleCard icon={<SparklesIcon className="h-4 w-4" />} label="Bloom" description="Lets bright lights glow softly." checked={scene.rendererSettings.enableBloom} onChange={(checked) => updateRendererSetting('enableBloom', checked)} />
              <SliderCard icon={<SparklesIcon className="h-4 w-4" />} label="Glow Amount" value={scene.rendererSettings.bloomIntensity} min={0} max={3} step={0.05} onChange={(value) => updateRendererSetting('bloomIntensity', value)} />
              <SliderCard icon={<SunIcon className="h-4 w-4" />} label="Glow Threshold" value={scene.rendererSettings.bloomThreshold} min={0} max={2} step={0.01} onChange={(value) => updateRendererSetting('bloomThreshold', value)} />
              <ToggleCard icon={<CameraIcon className="h-4 w-4" />} label="Depth of Field" description="Adds lens-style background blur." checked={scene.rendererSettings.enableDepthOfField} onChange={(checked) => updateRendererSetting('enableDepthOfField', checked)} />
              <SliderCard icon={<CameraIcon className="h-4 w-4" />} label="Background Blur" value={scene.rendererSettings.depthOfFieldStrength} min={0} max={6} step={0.05} onChange={(value) => updateRendererSetting('depthOfFieldStrength', value)} />
              <ToggleCard icon={<CircleIcon className="h-4 w-4" />} label="Vignette" description="Softly shapes the frame edge." checked={scene.rendererSettings.enableVignette} onChange={(checked) => updateRendererSetting('enableVignette', checked)} />
              <SliderCard icon={<CircleIcon className="h-4 w-4" />} label="Edge Fade" value={scene.rendererSettings.vignetteStrength} min={0} max={1.5} step={0.01} onChange={(value) => updateRendererSetting('vignetteStrength', value)} />
            </CollapsibleSection>

            <CollapsibleSection title="Camera Feel" icon={<CameraIcon className="h-4 w-4" />} defaultOpen={false}>
              <div className="flex flex-wrap gap-2">
                {cameraPresets.map((preset) => (
                  <button key={preset.id} type="button" onClick={() => applyCameraPreset(preset.id)} className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 text-[11px] font-extrabold text-white/70 transition hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]">
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ActionButton onClick={saveCurrentView} icon={<SaveIcon className="h-4 w-4" />}>Save View</ActionButton>
                <ActionButton onClick={returnToSavedView} disabled={!savedView} icon={<Redo2Icon className="h-4 w-4" />}>Return</ActionButton>
              </div>
              <SliderCard icon={<CameraIcon className="h-4 w-4" />} label="Lens Feel" value={scene.camera.focalLength} min={18} max={100} step={1} onChange={(value) => updateScene((current) => ({ ...current, camera: { ...current.camera, focalLength: value } }))} />
              <SliderCard icon={<CameraIcon className="h-4 w-4" />} label="Aperture" value={scene.camera.aperture} min={1.2} max={16} step={0.1} onChange={(value) => updateScene((current) => ({ ...current, camera: { ...current.camera, aperture: value } }))} />
              <SliderCard icon={<FocusIcon className="h-4 w-4" />} label="Focus Distance" value={scene.camera.focusDistance} min={0.5} max={30} step={0.1} onChange={(value) => updateScene((current) => ({ ...current, camera: { ...current.camera, focusDistance: value } }))} />
              <SliderCard icon={<Move3DIcon className="h-4 w-4" />} label="Fly Speed" value={scene.camera.moveSpeed} min={0.5} max={18} step={0.25} onChange={(value) => updateScene((current) => ({ ...current, camera: { ...current.camera, moveSpeed: value } }))} />
            </CollapsibleSection>

            <CollapsibleSection title="Advanced" icon={<Grid3X3Icon className="h-4 w-4" />} defaultOpen={false}>
              <div className="grid grid-cols-4 gap-2">
                {renderSizes.map((size) => (
                  <button key={size.label} type="button" onClick={() => setRenderSize(size)} className={`rounded-2xl border px-3 py-2 text-xs font-extrabold transition ${renderSize.label === size.label ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-black' : 'border-white/10 bg-white/[0.045] text-white/55 hover:bg-white/[0.08]'}`}>
                    {size.label}
                  </button>
                ))}
              </div>
              <select value={renderFormat} onChange={(event) => setRenderFormat(event.target.value as RenderFormat)} className="w-full rounded-2xl border border-white/10 bg-black/35 px-3 py-3 text-sm font-bold text-white">
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
              {isRendering && (
                <ActionButton onClick={cancelRender} variant="danger" className="w-full">
                  Cancel Render
                </ActionButton>
              )}
            </CollapsibleSection>

            {scene.renders.length > 0 && (
              <CollapsibleSection title="Render History" icon={<LayersIcon className="h-4 w-4" />} defaultOpen={false}>
                <div className="grid grid-cols-2 gap-3">
                  {scene.renders.slice(0, 8).map((render) => (
                    <RenderHistoryCard
                      key={render.id}
                      render={render}
                      onView={() => viewRender(render)}
                      onUse={() => useRender(render, 'reference')}
                      onDownload={() => downloadDataUrl(render.dataUrl, `${render.name}.${render.mimeType.includes('jpeg') ? 'jpg' : render.mimeType.split('/').pop() || 'png'}`)}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </div>

          <section className={`rounded-[24px] border border-white/10 bg-black/45 p-4 shadow-2xl shadow-black/25 backdrop-blur-2xl ${inspectorTab === 'objects' ? '' : 'hidden'}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-black text-[var(--color-text)]">Layers</h2>
              <span className="text-xs text-[var(--color-text-muted)]">{scene.objects.length}</span>
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {scene.objects.map((object) => (
                <button key={object.id} type="button" onClick={() => {
                  setSelectedLightId(null);
                  updateScene((current) => ({ ...current, selectedObjectId: object.id }), { history: false });
                }} className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left ${scene.selectedObjectId === object.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-white/10 bg-white/[0.035]'}`}>
                  <span className="min-w-0 truncate text-xs font-extrabold text-[var(--color-text)]">{object.name}</span>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: object.material.color }} />
                </button>
              ))}
            </div>
          </section>

        </aside>
      </div>
    </div>
  );
};
