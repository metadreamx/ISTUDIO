
// --- General App Types ---

export type AppView = 'dashboard' | 'style-transfer' | 'virtual-set';

export interface ImageState {
  fileName: string | null;
  base64: string | null;
  mimeType: string | null;
  width?: number | null;
  height?: number | null;
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

export type VirtualSetRuntimeState = 'unavailable' | 'stopped' | 'starting' | 'running' | 'error';
export type VirtualSetObjectType = 'plane' | 'wall' | 'cube' | 'sphere' | 'cylinder' | 'backdrop' | 'platform' | 'image-plane';
export type VirtualSetPreset = 'studio-cyc' | 'rooftop' | 'showroom' | 'warehouse' | 'fashion-set' | 'product-stage';
export type VirtualSetSkyPreset = 'clear' | 'cloudy' | 'sunset' | 'night' | 'hdri';

export interface VirtualSetStatus {
  state: VirtualSetRuntimeState;
  runtimeAvailable: boolean;
  streamUrl: string | null;
  message: string;
  projectId: string | null;
  startedAt: number | null;
  runtimePath?: string | null;
}

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
  color: string;
  roughness: number;
  metallic: number;
  transform: VirtualSetTransform;
  image?: ImageState | null;
}

export interface VirtualSetCamera {
  focalLength: number;
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

export interface VirtualSetRender {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
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
  camera: VirtualSetCamera;
  lighting: VirtualSetLighting;
  renders: VirtualSetRender[];
  updatedAt: number;
}

export interface VirtualSetProjectState {
  activeSceneId: string | null;
  scenes: VirtualSetScene[];
  lastRuntimeStatus?: VirtualSetStatus | null;
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
