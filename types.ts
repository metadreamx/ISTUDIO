
// --- General App Types ---

export type AppView = 'dashboard' | 'style-transfer' | 'canvas';

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
    canvasDocumentCount: number;
  };
}

// --- Canvas Tool ---

export type CanvasTool = 'select' | 'image' | 'text' | 'shape' | 'brush' | 'hand';
export type CanvasPanel = 'templates' | 'assets' | 'layers' | 'properties' | 'ai' | 'history';
export type CanvasExportFormat = 'png' | 'jpeg' | 'webp';
export type CanvasLayerType = 'image' | 'text' | 'shape' | 'brush' | 'group' | 'mask' | 'adjustment' | 'reference' | 'ai-result';
export type CanvasImageFitMode = 'fit' | 'fill' | 'crop' | 'stretch';

export interface CanvasImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasAsset {
  id: string;
  name: string;
  image: ImageState;
  createdAt: number;
}

export interface CanvasExport {
  id: string;
  name: string;
  dataUrl: string;
  format: CanvasExportFormat;
  width: number;
  height: number;
  createdAt: number;
}

export interface CanvasLayerBase {
  id: string;
  type: CanvasLayerType;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode?: GlobalCompositeOperation;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface CanvasImageLayer extends CanvasLayerBase {
  type: 'image' | 'reference' | 'ai-result';
  source: ImageState;
  fitMode?: CanvasImageFitMode;
  crop?: CanvasImageCrop | null;
  naturalWidth?: number | null;
  naturalHeight?: number | null;
  flipX?: boolean;
  flipY?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
}

export interface CanvasTextLayer extends CanvasLayerBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontStyle: 'normal' | 'bold' | 'italic' | 'bold italic';
  fill: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
}

export interface CanvasShapeLayer extends CanvasLayerBase {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius?: number;
}

export interface CanvasBrushLayer extends CanvasLayerBase {
  type: 'brush' | 'mask';
  points: number[];
  stroke: string;
  strokeWidth: number;
  tension: number;
  tool?: 'paint' | 'erase' | 'mask';
}

export type CanvasLayer = CanvasImageLayer | CanvasTextLayer | CanvasShapeLayer | CanvasBrushLayer;

export interface CanvasDocument {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: CanvasLayer[];
  assets: CanvasAsset[];
  exports: CanvasExport[];
  createdAt: number;
  updatedAt: number;
}

export interface CanvasProjectState {
  activeDocumentId: string | null;
  documents: CanvasDocument[];
}

export interface CanvasTemplate {
  id: string;
  title: string;
  category: string;
  description: string;
  width: number;
  height: number;
  background: string;
  layers: CanvasLayer[];
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
