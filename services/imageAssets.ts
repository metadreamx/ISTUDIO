import type { ImageState } from '../types';
import { normalizeGeminiImageMimeType, processImageDataUrl, type EditImageQualityMode } from './geminiService';

export function getImageSrc(image?: ImageState | null): string | null {
  if (!image) return null;
  if (image.assetUrl) return image.assetUrl;
  if (image.base64 && image.mimeType) return `data:${image.mimeType};base64,${image.base64}`;
  return null;
}

export function hasImageSource(image?: ImageState | null): boolean {
  return Boolean(getImageSrc(image));
}

export function stripImageBase64(image: ImageState): ImageState {
  return {
    ...image,
    base64: null,
  };
}

export async function imageToDataUrl(image: ImageState): Promise<string> {
  const source = getImageSrc(image);
  if (!source) {
    throw new Error(`Missing image data for ${image.fileName || 'image'}.`);
  }
  if (source.startsWith('data:')) {
    return source;
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Could not load ${image.fileName || 'image'} from the project folder.`);
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${image.fileName || 'image'} from the project folder.`));
    reader.readAsDataURL(blob);
  });
}

export async function imageToGeminiInput(image: ImageState, mode: EditImageQualityMode = 'single'): Promise<ImageState> {
  if (image.base64 && image.mimeType && mode === 'single') {
    const normalizedMimeType = normalizeGeminiImageMimeType(image.mimeType);
    if (normalizedMimeType === image.mimeType.toLowerCase()) {
      return {
        ...image,
        mimeType: normalizedMimeType,
      };
    }
  }

  const dataUrl = await imageToDataUrl(image);
  return processImageDataUrl(dataUrl, image.fileName || 'image', mode);
}
