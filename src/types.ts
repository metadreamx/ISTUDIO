
export type GenerationStatus = 'idle' | 'processing' | 'completed' | 'error';

export interface ImageState {
  id: string;
  fileName: string | null;
  base64: string | null;
  mimeType: string | null;
}

export interface BatchImage {
  id: string;
  originalUrl: string;
  styledUrl?: string;
  status: 'idle' | 'processing' | 'completed' | 'error';
  error?: string;
}

export interface StyleItem {
  id: string;
  name: string;
  description: string;
}

export interface StyleCategory {
  id: string;
  name: string;
  items: StyleItem[];
}

export interface ProjectState {
  id: string;
  name: string;
  images: BatchImage[];
  selectedStyles: string[];
  status: GenerationStatus;
  createdAt: number;
  updatedAt: number;
}
