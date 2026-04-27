
import { StyleCategory, ImageState } from './types';

export interface StylePreset {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  referenceImage: ImageState;
  checklist: StyleCategory[];
}

export const POPULAR_PRESETS: StylePreset[] = [];
