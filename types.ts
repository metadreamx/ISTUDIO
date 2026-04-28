
// --- General App Types ---

export type AppView = 'dashboard' | 'style-transfer';

export interface ImageState {
  fileName: string | null;
  base64: string | null;
  mimeType: string | null;
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
