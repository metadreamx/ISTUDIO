
// --- General App Types ---

export type AppView = 'dashboard' | 'style-transfer' | 'color-grade' | 'virtual-set';

export interface ImageState {
  fileName: string | null;
  base64: string | null;
  mimeType: string | null;
  width?: number | null;
  height?: number | null;
  assetPath?: string | null;
  assetUrl?: string | null;
}

export type ProAiAcceleration = 'directml' | 'webgpu' | 'cpu' | 'unavailable';

export interface ProAiModelStatus {
  id: string;
  task: string;
  installed: boolean;
  path?: string;
  inputSize?: number;
}

export interface ProToolStatus {
  available: boolean;
  installed: boolean;
  runtimeReady: boolean;
  acceleration: ProAiAcceleration;
  message: string;
  models: ProAiModelStatus[];
}

export interface ProCullResult {
  score: number;
  pickStatus: 'pick' | 'review' | 'reject';
  rating: number;
  flags: string[];
  sharpnessScore: number;
  exposureScore: number;
  contrastScore: number;
  faceCount: number | null;
  eyeStatus: string;
  analyzedAt: number;
}

export interface ProToolImageResult {
  image: ImageState;
  mask?: ImageState;
  modelUsed?: string;
  message: string;
  settings?: Record<string, unknown>;
}

export interface ProFinishSettings {
  sharpen: number;
  denoise: number;
  clarity: number;
  brightness: number;
  saturation: number;
}

// --- Color Grade Studio ---

export type ColorMatchMethod = 'auto' | 'natural' | 'histogram' | 'reinhard' | 'distribution' | 'hybrid' | 'lab' | 'pdf';
export type ResolvedColorMatchMethod = Exclude<ColorMatchMethod, 'auto'>;

export interface ColorGradeDiagnostics {
  engineVersion: string;
  selectedStrategy: ResolvedColorMatchMethod;
  confidence: number;
  overallScore: number;
  toneScore: number;
  colorScore: number;
  contrastScore: number;
  detailScore: number;
  clippingScore: number;
  clippedShadows: number;
  clippedHighlights: number;
  analyzedAt: number;
}

export interface ColorGradeSettings {
  matchMethod: ColorMatchMethod;
  autoMethod: ResolvedColorMatchMethod;
  matchStrength: number;
  luminanceMatch: number;
  colorMatch: number;
  contrastMatch: number;
  detailProtection: number;
  exposure: number;
  brightness: number;
  contrast: number;
  gamma: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  vibrance: number;
  saturation: number;
  clarity: number;
  sharpness: number;
  shadowColor: string;
  shadowColorStrength: number;
  midtoneColor: string;
  midtoneColorStrength: number;
  highlightColor: string;
  highlightColorStrength: number;
  fade: number;
  vignette: number;
  grain: number;
}

export interface ColorGradeOutput {
  id: string;
  image: ImageState;
  createdAt: number;
  settings: ColorGradeSettings;
  diagnostics?: ColorGradeDiagnostics | null;
}

export interface ColorGradeProjectState {
  targetImage: ImageState;
  referenceImage: ImageState;
  settings: ColorGradeSettings;
  outputs: ColorGradeOutput[];
  matchSummary?: string | null;
  matchAnalyzedAt?: number | null;
  matchDiagnostics?: ColorGradeDiagnostics | null;
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

export type ProjectStorageMode = 'folder' | 'browser';

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
export type AspectRatio =
  | '1:1'
  | '1:4'
  | '1:8'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:1'
  | '4:3'
  | '4:5'
  | '5:4'
  | '8:1'
  | '9:16'
  | '16:9'
  | '21:9';

export interface GenerationSettingsSnapshot {
  aspectRatio?: AspectRatio | null;
  anchorImageId?: string | null;
  promptEdit?: string;
  referenceFileNames?: string[];
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
    rating?: number;
    pickStatus?: 'pick' | 'review' | 'reject';
    cullScore?: number;
    flags?: string[];
    sharpnessScore?: number;
    exposureScore?: number;
    contrastScore?: number;
    faceCount?: number | null;
    eyeStatus?: string | null;
    proofNotes?: string;
    finishSettings?: ProFinishSettings;
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
