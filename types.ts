
// --- General App Types ---

export type AppView = 'dashboard' | 'style-transfer' | 'virtual-set';

export interface ImageState {
  fileName: string | null;
  base64: string | null;
  mimeType: string | null;
  width?: number | null;
  height?: number | null;
  assetPath?: string | null;
  assetUrl?: string | null;
}

export interface ImageTransferState {
  dataUrl: string;
  fileName: string;
  targetView: AppView;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  lastModified: number;
  state: any; // Stores the full project state
  generatedImages: string[]; // Added this
  summary?: {
    isSummary: boolean;
    outputCount: number;
    virtualSetSceneCount?: number;
  };
}

// --- Tethered Capture ---

export type TetherCaptureStatus = 'imported' | 'ignored' | 'failed';

export interface TetherCapture {
  id: string;
  fileName: string;
  sourcePath: string;
  projectId: string | null;
  status: TetherCaptureStatus;
  message?: string;
  createdAt: number;
  importedAt?: number;
  image?: ImageState;
}

export interface TetherStatus {
  isWatching: boolean;
  folderPath: string | null;
  projectId: string | null;
  autoEdit: boolean;
  startedAt: number | null;
  message: string | null;
  captures: TetherCapture[];
  supportedExtensions: string[];
  rawExtensions: string[];
}

export interface TetherProjectState {
  folderPath?: string;
  autoEdit?: boolean;
  importedCaptureIds?: string[];
  activeSessionStartedAt?: number | null;
}

// --- Virtual Set Studio ---

export type VirtualSetObjectType = 'plane' | 'wall' | 'cube' | 'sphere' | 'cylinder' | 'backdrop' | 'platform' | 'image-plane' | 'model';
export type VirtualSetPreset = 'studio-cyc' | 'rooftop' | 'showroom' | 'warehouse' | 'fashion-set' | 'product-stage';
export type VirtualSetSkyPreset = 'clear' | 'cloudy' | 'sunset' | 'night' | 'hdri';
export type VirtualSetAssetType = 'image' | 'model' | 'texture' | 'environment';
export type VirtualSetLightType = 'directional' | 'area' | 'spot' | 'point' | 'panel';
export type VirtualSetMaterialPreset = 'matte-paper' | 'studio-floor' | 'concrete' | 'fabric' | 'glossy-acrylic' | 'chrome' | 'glass' | 'emissive-panel';
export type VirtualSetPreviewQuality = 'draft' | 'balanced' | 'ultra';
export type VirtualSetRenderState = 'preview' | 'path-tracing' | 'converging' | 'ready' | 'canceled' | 'saved';

export interface VirtualSetTransform {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface VirtualSetObject {
  id: string;
  name: string;
  type: VirtualSetObjectType;
  visible: boolean;
  locked: boolean;
  transform: VirtualSetTransform;
  material: VirtualSetMaterial;
  image?: ImageState | null;
  assetId?: string | null;
}

export interface VirtualSetCamera {
  focalLength: number;
  aperture: number;
  focusDistance: number;
  moveSpeed: number;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export interface VirtualSetLighting {
  skyPreset: VirtualSetSkyPreset;
  timeOfDay: number;
  sunAngle: number;
  sunIntensity: number;
  fillIntensity: number;
  rimIntensity: number;
  colorTemperature: number;
  fog: number;
}

export interface VirtualSetAsset {
  id: string;
  type: VirtualSetAssetType;
  name: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  resources?: {
    fileName: string;
    mimeType: string;
    dataUrl: string;
  }[];
  width?: number | null;
  height?: number | null;
}

export interface VirtualSetMaterial {
  preset: VirtualSetMaterialPreset;
  color: string;
  roughness: number;
  metallic: number;
  clearcoat: number;
  clearcoatRoughness?: number;
  transmission: number;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
  reflectionIntensity?: number;
  specularIntensity?: number;
  ior?: number;
  thickness?: number;
  normalStrength?: number;
  textureAssetId?: string | null;
  normalAssetId?: string | null;
  roughnessAssetId?: string | null;
  metalnessAssetId?: string | null;
}

export interface VirtualSetLight {
  id: string;
  name: string;
  type: VirtualSetLightType;
  enabled: boolean;
  color: string;
  intensity: number;
  temperature: number;
  range: number;
  angle: number;
  penumbra: number;
  softness: number;
  width: number;
  height: number;
  transform: VirtualSetTransform;
}

export interface VirtualSetEnvironment {
  skyPreset: VirtualSetSkyPreset;
  backgroundTop: string;
  backgroundBottom: string;
  ambientIntensity: number;
  reflectionIntensity: number;
  showBackground?: boolean;
  fog: number;
  fogColor: string;
  hdriAssetId?: string | null;
}

export interface VirtualSetRendererSettings {
  previewQuality: VirtualSetPreviewQuality;
  renderState: VirtualSetRenderState;
  samples: number;
  bounces: number;
  filterGlossyFactor: number;
  exposure: number;
  enableSSAO: boolean;
  ambientOcclusionIntensity: number;
  enableBloom: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  enableDepthOfField: boolean;
  depthOfFieldStrength: number;
  enableVignette: boolean;
  vignetteStrength: number;
  shadowQuality: number;
}

export interface VirtualSetRender {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
  mode?: 'preview' | 'beauty';
  samples?: number;
}

export interface VirtualSetScene {
  id: string;
  name: string;
  preset: VirtualSetPreset;
  width: number;
  height: number;
  backgroundColor: string;
  selectedObjectId: string | null;
  objects: VirtualSetObject[];
  assets: VirtualSetAsset[];
  materials: VirtualSetMaterial[];
  lights: VirtualSetLight[];
  environment: VirtualSetEnvironment;
  rendererSettings: VirtualSetRendererSettings;
  camera: VirtualSetCamera;
  lighting: VirtualSetLighting;
  renders: VirtualSetRender[];
  updatedAt: number;
}

export interface VirtualSetProjectState {
  activeSceneId: string | null;
  scenes: VirtualSetScene[];
  activeReferenceRenderId?: string | null;
}

export interface ReferenceTemplate {
  id: string;
  title: string;
  category: string;
  description: string;
  fileName: string;
  url: string;
}

export type ExportFormat = 'png' | 'jpeg';
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export interface GenerationSettingsSnapshot {
  aspectRatio?: AspectRatio | null;
  anchorImageId?: string | null;
  selectedCategories: {
    id: string;
    label: string;
    intensity: number;
    items: string[];
  }[];
  customAssets: string[];
}

export interface HistoryItem {
  id: number;
  projectId: string; // Reference to the project
  generated: string;
  target: ImageState;
  reference: ImageState;
  targetId?: string;
  targetFileName?: string | null;
  settings?: GenerationSettingsSnapshot;
}

export interface BatchImage {
    id: string;
    target: ImageState;
    generated: string | null;
    status: 'pending' | 'queued' | 'processing' | 'done' | 'error';
    dominantColor: string | null;
    source?: 'manual' | 'tether';
    tetherCaptureId?: string;
}

// --- Style Transfer ---

export interface StyleSubItem {
  id: string;
  label: string;
  description: string;
  confidence: 'high' | 'medium' | 'low';
  checked: boolean;
  customValue?: string; // Stores user input for this specific item (e.g. text content)
}

export interface StyleCategory {
  id: string;
  label: string;
  items: StyleSubItem[];
  intensity: number;
  customText?: string;
  customTextStyle?: string;
  customPrompt?: string;
}

export interface CustomClothingItem {
  id: string;
  image: ImageState;
  analysis: string | null;
  enabled: boolean;
  status: 'empty' | 'uploading' | 'analyzing' | 'ready' | 'error';
}

export interface CustomAccessoryItem {
  id: string;
  image: ImageState;
  analysis: string | null;
  enabled: boolean;
  status: 'empty' | 'uploading' | 'analyzing' | 'ready' | 'error';
}

export interface CustomFaceItem {
  image: ImageState;
  analysis: string | null;
  enabled: boolean;
  status: 'empty' | 'uploading' | 'analyzing' | 'ready' | 'error';
}

export interface CustomBackgroundItem {
  image: ImageState;
  analysis: string | null;
  enabled: boolean;
  status: 'empty' | 'uploading' | 'analyzing' | 'ready' | 'error';
}

export interface CustomSkyItem {
  image: ImageState;
  analysis: string | null;
  enabled: boolean;
  status: 'empty' | 'uploading' | 'analyzing' | 'ready' | 'error';
}

export interface Subject {
  id: string;
  name: string;
  regions: {
    [key: string]: object; // Placeholder for mask data
  };
}
