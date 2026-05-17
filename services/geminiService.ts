
import { GoogleGenAI, Type, type GenerateContentConfig, type GenerateContentResponse } from "@google/genai";
import type { StyleCategory, ImageState, StyleSubItem, AspectRatio } from '../types';

export const GEMINI_ANALYSIS_MODELS = ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.0-flash'] as const;
export const GEMINI_IMAGE_EDIT_MODELS = ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'] as const;
const GEMINI_IMAGE_SIZES = ['4K', '2K', '1K'] as const;

type GeminiContentPart = { inlineData: { data: string; mimeType: string } } | { text: string };
type GeminiContentPayload = {
  parts: GeminiContentPart[];
  role?: string;
};
type GeminiGeneratePayload = {
  model: string;
  contents: GeminiContentPayload;
  config?: GenerateContentConfig;
  requestType?: 'analysis' | 'image-edit' | 'diagnostic';
};
type GeminiRelaySuccess = {
  ok: true;
  modelUsed: string;
  response: GenerateContentResponse;
  transport: GeminiTransportMode;
};
type GeminiRelayFailure = {
  ok: false;
  errorCode: string;
  userMessage: string;
  rawStatus?: number;
  rawMessage?: string;
  transport?: GeminiTransportMode;
};
type GeminiRelayResponse = GeminiRelaySuccess | GeminiRelayFailure;
export type GeminiTransportMode = 'local-relay' | 'cloud-relay' | 'direct-dev';

const GEMINI_RELAY_HEADER = 'x-istudio-gemini-key';
const DEFAULT_CLOUD_RELAY_URL = '';

function runtimeEnv(): Record<string, string | undefined> {
  return ((import.meta as unknown as { env?: Record<string, string | undefined> }).env || {});
}

export function getStoredGeminiApiKey(): string {
  return localStorage.getItem('user_api_key')?.trim() || '';
}

function getBuildGeminiApiKey(): string {
  return (process.env.API_KEY || process.env.GEMINI_API_KEY || '').trim();
}

function getGeminiApiKey(overrideKey?: string): string {
  const API_KEY = (overrideKey || getStoredGeminiApiKey() || getBuildGeminiApiKey()).trim();

    if (!API_KEY) {
      throw new Error("Gemini API key is missing. On iPhone, tap Settings and enter your Google Gemini API key before analyzing or generating.");
    }
    return API_KEY;
}

// User-entered keys must win over bundled/build-time keys so a stale release
// key can never block a working key pasted in Settings.
const getAiClient = (overrideKey?: string) => new GoogleGenAI({ apiKey: getGeminiApiKey(overrideKey) });

function getConfiguredCloudRelayUrl(): string {
  const configured = runtimeEnv().VITE_GEMINI_RELAY_URL || DEFAULT_CLOUD_RELAY_URL;
  return (configured || '').trim().replace(/\/+$/, '');
}

function isLoopbackHost(hostname = window.location.hostname.toLowerCase()): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

export function getGeminiTransportMode(): GeminiTransportMode {
  if (typeof window !== 'undefined' && isLoopbackHost()) {
    return 'local-relay';
  }
  if (getConfiguredCloudRelayUrl()) {
    return 'cloud-relay';
  }
  return 'direct-dev';
}

export function getGeminiTransportLabel(): string {
  const mode = getGeminiTransportMode();
  if (mode === 'local-relay') return 'Local Relay';
  if (mode === 'cloud-relay') return 'Cloud Relay';
  return 'Direct Dev';
}

export function getGeminiRelayDiagnostic(): { status: 'ready' | 'missing' | 'local' | 'dev'; label: string; message: string } {
  const mode = getGeminiTransportMode();
  if (mode === 'cloud-relay') {
    return {
      status: 'ready',
      label: 'Cloud Relay connected',
      message: 'Mobile requests will use the same Gemini relay flow as desktop.',
    };
  }
  if (mode === 'local-relay') {
    return {
      status: 'local',
      label: 'Local Relay connected',
      message: 'Desktop requests are routed through the local ISTUDIO server.',
    };
  }
  if (typeof window !== 'undefined' && !isLoopbackHost()) {
    return {
      status: 'missing',
      label: 'Cloud Relay missing',
      message: 'The iPhone PWA was built without VITE_GEMINI_RELAY_URL, so reference analysis and generation are disabled until the relay is configured.',
    };
  }
  return {
    status: 'dev',
    label: 'Direct Dev',
    message: 'Development fallback is active.',
  };
}

export async function testGeminiConnection(apiKey?: string): Promise<{ ok: true; modelUsed: string; transport: GeminiTransportMode; message: string }> {
  const result = await generateWithRetryRaw(() => generateContentTransport({
    model: GEMINI_ANALYSIS_MODELS[0],
    requestType: 'diagnostic',
    contents: {
      parts: [{ text: 'Reply with exactly: ISTUDIO Gemini connected.' }],
    },
    config: {
      temperature: 0,
    },
  }, apiKey));

  return {
    ok: true,
    modelUsed: result.modelUsed,
    transport: result.transport,
    message: getResponseText(result.response) || 'Gemini connected.',
  };
}

function relayEndpointForMode(mode: GeminiTransportMode): string | null {
  if (mode === 'local-relay') return '/api/gemini/generate';
  if (mode === 'cloud-relay') return `${getConfiguredCloudRelayUrl()}/api/gemini/generate`;
  return null;
}

function normalizeRelayError(error: any, mode?: GeminiTransportMode): GeminiRelayFailure {
  const status = Number(error?.rawStatus || error?.status || error?.code || 0) || undefined;
  const message = String(error?.userMessage || error?.rawMessage || error?.message || error || 'Gemini request failed.');
  const lower = message.toLowerCase();
  let errorCode = String(error?.errorCode || 'GEMINI_REQUEST_FAILED');
  let userMessage = message;

  if (status === 401 || status === 403 || lower.includes('api key') || lower.includes('permission_denied') || lower.includes('forbidden')) {
    errorCode = 'GEMINI_KEY_REJECTED';
    userMessage = 'Gemini could not use this API key. Re-enter a valid Google Gemini API key and confirm the Gemini API is enabled for that Google project.';
  } else if (lower.includes('service_disabled') || lower.includes('api has not been used') || lower.includes('generative language api') && lower.includes('disabled')) {
    errorCode = 'GEMINI_API_DISABLED';
    userMessage = 'The Gemini API is not enabled for this Google project. Enable the Gemini API for the key, then try Test Gemini again.';
  } else if (status === 429 || lower.includes('quota') || lower.includes('resource_exhausted') || lower.includes('spending cap')) {
    errorCode = 'GEMINI_QUOTA';
    userMessage = 'Gemini reached the quota or billing limit for this API key. Check your Google AI billing and quota settings.';
  } else if (isModelUnavailableError(error)) {
    errorCode = 'GEMINI_MODEL_UNAVAILABLE';
    userMessage = "Gemini's current model is unavailable for this API key. ISTUDIO tried the supported fallback models, but none were available.";
  } else if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    errorCode = 'GEMINI_RELAY_UNREACHABLE';
    userMessage = mode === 'cloud-relay'
      ? 'ISTUDIO could not reach the Gemini cloud relay. Check your connection and try again.'
      : 'ISTUDIO could not reach the local Gemini relay. Restart ISTUDIO from LAUNCH.bat and try again.';
  }

  return {
    ok: false,
    errorCode,
    userMessage,
    rawStatus: status,
    rawMessage: message,
    transport: mode,
  };
}

async function generateContentDirect(payload: GeminiGeneratePayload, apiKey?: string): Promise<GeminiRelaySuccess> {
  const ai = getAiClient(apiKey);
  const response = await ai.models.generateContent({
    model: payload.model,
    contents: payload.contents,
    ...(payload.config ? { config: payload.config } : {}),
  });
  return {
    ok: true,
    modelUsed: payload.model,
    response,
    transport: 'direct-dev',
  };
}

async function generateContentViaRelay(payload: GeminiGeneratePayload, mode: GeminiTransportMode, apiKey?: string): Promise<GeminiRelaySuccess> {
  const endpoint = relayEndpointForMode(mode);
  if (!endpoint) {
    return generateContentDirect(payload, apiKey);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [GEMINI_RELAY_HEADER]: getGeminiApiKey(apiKey),
    },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => null) as GeminiRelayResponse | null;
  if (!response.ok || !json?.ok) {
    const failure = normalizeRelayError(json || { status: response.status, message: response.statusText }, mode);
    throw Object.assign(new Error(failure.userMessage), failure);
  }

  return {
    ...json,
    transport: mode,
  };
}

async function generateContentTransport(payload: GeminiGeneratePayload, apiKey?: string): Promise<GeminiRelaySuccess> {
  const mode = getGeminiTransportMode();
  if (mode === 'direct-dev' && !isLoopbackHost()) {
    throw Object.assign(
      new Error('The mobile Gemini relay is not configured yet. Set VITE_GEMINI_RELAY_URL for the GitHub Pages build, then republish ISTUDIO.'),
      {
        ok: false,
        errorCode: 'GEMINI_RELAY_NOT_CONFIGURED',
        userMessage: 'The mobile Gemini relay is not configured yet. Set VITE_GEMINI_RELAY_URL for the GitHub Pages build, then republish ISTUDIO.',
        transport: mode,
      },
    );
  }

  try {
    return await generateContentViaRelay(payload, mode, apiKey);
  } catch (error) {
    if (mode === 'local-relay') {
      console.warn('Local Gemini relay unavailable, falling back to direct dev transport.', error);
      return generateContentDirect(payload, apiKey);
    }
    throw error;
  }
};

async function hashString(str: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getFromCache(key: string): any | null {
  const cached = localStorage.getItem(key);
  return cached ? JSON.parse(cached) : null;
}

function saveToCache(key: string, value: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("localStorage quota exceeded, could not cache result", e);
  }
}

function toUserFacingGeminiError(error: any): Error {
    const relayFailure = normalizeRelayError(error, error?.transport);
    if (error?.errorCode || error?.userMessage) {
      return new Error(relayFailure.userMessage);
    }
    const message = String(error?.message || error || '');
    const status = Number(error?.status || error?.code || 0);
    if (isModelUnavailableError(error)) {
      return new Error("Gemini's current preview model is unavailable for this API key. ISTUDIO tried the supported fallback models, but none were available. Make sure the Gemini API is enabled for your Google project.");
    }
    if (status === 401 || status === 403 || message.includes('API key') || message.includes('API_KEY') || message.includes('Forbidden') || message.includes('PERMISSION_DENIED')) {
      return new Error("Gemini could not use this API key. Re-enter a valid Google Gemini API key and confirm the Gemini API is enabled for that Google project.");
    }
    if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed')) {
      return new Error("Gemini could not be reached. Check your connection and make sure ISTUDIO's Gemini relay is available.");
    }
    return error instanceof Error ? error : new Error(message || 'Gemini request failed.');
}

function getResponseText(response: GenerateContentResponse): string {
  const directText = typeof response.text === 'string' ? response.text.trim() : '';
  if (directText) return directText;
  const candidateText = response.candidates?.[0]?.content?.parts
    ?.map((part: any) => typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim();
  return candidateText || '';
}

function getGeminiErrorMessage(error: any): string {
  return String(error?.message || error || '');
}

function isModelUnavailableError(error: any): boolean {
  const message = getGeminiErrorMessage(error).toLowerCase();
  const status = Number(error?.status || error?.code || 0);
  return (
    status === 404 ||
    (message.includes('model') && (
      message.includes('not found') ||
      message.includes('not available') ||
      message.includes('not supported') ||
      message.includes('unsupported')
    )) ||
    message.includes('requested entity was not found')
  );
}

function isImageConfigError(error: any): boolean {
  const message = getGeminiErrorMessage(error).toLowerCase();
  return message.includes('imagesize') || message.includes('image size') || message.includes('aspectratio') || message.includes('aspect ratio') || message.includes('imageconfig');
}

type GeminiContentResult = {
  response: GenerateContentResponse;
  model: string;
  imageSize?: string;
  transport?: GeminiTransportMode;
};

// Retry logic for transient API errors (429 Quota, 503 Overloaded, 500 Internal)
async function generateWithRetryRaw<T>(operation: () => Promise<T>, retries = 4, delay = 2500): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        const code = error.status || error.code;
        const message = error.message || '';
        
        // Handle spending cap exceeded errors
        if (message.includes('spending cap')) {
            console.error("Gemini API Spending Cap Exceeded:", message);
            throw new Error("Gemini API Quota Exceeded: Your project has exceeded its spending cap. Please check your Google Cloud billing settings.");
        }

        if (message.includes('Forbidden')) {
            console.error("Gemini API Forbidden error. This usually means the API key is missing, invalid, or lacks permissions for the selected model.");
            throw error;
        }

        const isTransient = code === 429 || code === 503 || code === 500 || message.includes('overloaded') || message.includes('Internal Server Error') || message.includes('UNAVAILABLE') || message.includes('RESOURCE_EXHAUSTED');
        
        if (isTransient && retries > 0) {
            console.warn(`Gemini API transient error (${code}): ${message}. Retrying in ${delay}ms... (Retries left: ${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return generateWithRetryRaw(operation, retries - 1, delay * 2);
        }
        
        console.error(`Gemini API fatal error (${code}): ${message}`);
        throw error;
    }
}

async function generateWithRetry<T>(operation: () => Promise<T>, retries = 4, delay = 2500): Promise<T> {
    try {
        return await generateWithRetryRaw(operation, retries, delay);
    } catch (error) {
        throw toUserFacingGeminiError(error);
    }
}

async function generateContentWithModelFallback(
  models: readonly string[],
  buildParams: (model: string) => GeminiGeneratePayload,
  label: string,
): Promise<GeminiContentResult> {
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const result = await generateWithRetryRaw(() => generateContentTransport(buildParams(model)));
      return { response: result.response, model: result.modelUsed || model, transport: result.transport };
    } catch (error) {
      lastError = error;
      if (isModelUnavailableError(error)) {
        console.warn(`Gemini ${label} model unavailable, trying fallback: ${model}`, error);
        continue;
      }
      throw toUserFacingGeminiError(error);
    }
  }

  throw toUserFacingGeminiError(lastError || new Error(`No Gemini ${label} model was available.`));
}

async function generateAnalysis(
  contents: GeminiContentPayload,
  config: GenerateContentConfig | undefined,
  label: string,
): Promise<GenerateContentResponse> {
  const result = await generateContentWithModelFallback(
    GEMINI_ANALYSIS_MODELS,
    (model) => ({
      model,
      contents,
      ...(config ? { config } : {}),
      requestType: 'analysis',
    }),
    label,
  );
  return result.response;
}

async function generateImageEditWithFallback(
  contents: GeminiContentPayload,
  aspectRatio?: AspectRatio,
  seed?: number,
): Promise<GeminiContentResult> {
  let lastError: unknown = null;

  for (const model of GEMINI_IMAGE_EDIT_MODELS) {
    for (const imageSize of GEMINI_IMAGE_SIZES) {
      try {
        const result = await generateWithRetryRaw(() => generateContentTransport({
          model,
          contents,
          config: {
            responseModalities: ['IMAGE', 'TEXT'],
            imageConfig: {
              imageSize,
              ...(aspectRatio ? { aspectRatio } : {}),
            },
            ...(seed !== undefined ? { seed } : {}),
          },
          requestType: 'image-edit',
        }));
        return { response: result.response, model: result.modelUsed || model, imageSize, transport: result.transport };
      } catch (error) {
        lastError = error;
        if (isImageConfigError(error) && imageSize !== GEMINI_IMAGE_SIZES[GEMINI_IMAGE_SIZES.length - 1]) {
          console.warn(`Gemini rejected ${imageSize} image output, retrying smaller output.`, error);
          continue;
        }
        if (isModelUnavailableError(error) || isImageConfigError(error)) {
          console.warn(`Gemini image model/config unavailable, trying fallback: ${model} ${imageSize}`, error);
          break;
        }
        throw toUserFacingGeminiError(error);
      }
    }
  }

  throw toUserFacingGeminiError(lastError || new Error('No Gemini image generation model was available.'));
}

export type EditImageQualityMode = 'single' | 'batch';

const SUPPORTED_GEMINI_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function normalizeGeminiImageMimeType(mimeType: string | null | undefined): string {
  const normalized = (mimeType || 'image/jpeg').toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  return SUPPORTED_GEMINI_IMAGE_MIME_TYPES.has(normalized) ? normalized : 'image/jpeg';
}

const fileToGenerativePart = (base64: string, mimeType: string) => {
    return {
        inlineData: {
            data: base64,
            mimeType: normalizeGeminiImageMimeType(mimeType),
        },
    };
};

const MAX_INLINE_REQUEST_BYTES = 18 * 1024 * 1024;
const EDIT_IMAGE_JPEG_QUALITY = 0.94;
const EDIT_IMAGE_LIMITS: Record<EditImageQualityMode, { maxLongEdge: number; maxMegapixels: number; maxInlineBytes: number }> = {
  single: {
    maxLongEdge: 4096,
    maxMegapixels: 18,
    maxInlineBytes: 8.5 * 1024 * 1024,
  },
  batch: {
    maxLongEdge: 3072,
    maxMegapixels: 10,
    maxInlineBytes: 5 * 1024 * 1024,
  },
};

const passthroughMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function getMimeTypeFromDataUrl(dataUrl: string, fallback: string): string {
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  const mimeType = (match?.[1] || fallback || 'image/jpeg').toLowerCase();
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function getHighFidelityEditSize(width: number, height: number, mode: EditImageQualityMode): { width: number; height: number; resized: boolean } {
  const limits = EDIT_IMAGE_LIMITS[mode];
  const longEdge = Math.max(width, height);
  const megapixels = (width * height) / 1_000_000;
  const edgeScale = longEdge > limits.maxLongEdge ? limits.maxLongEdge / longEdge : 1;
  const megapixelScale = megapixels > limits.maxMegapixels ? Math.sqrt(limits.maxMegapixels / megapixels) : 1;
  const scale = Math.min(1, edgeScale, megapixelScale);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: scale < 0.999,
  };
}

function encodeCanvasForGemini(canvas: HTMLCanvasElement, mimeType: string, mode: EditImageQualityMode): string {
  if (mimeType === 'image/png') {
    return canvas.toDataURL(mimeType);
  }

  const limits = EDIT_IMAGE_LIMITS[mode];
  let quality = EDIT_IMAGE_JPEG_QUALITY;
  let dataUrl = canvas.toDataURL(mimeType, quality);
  while (estimateBase64Bytes(dataUrl.split(',')[1] || '') > limits.maxInlineBytes && quality > 0.86) {
    quality = Math.max(0.86, quality - 0.02);
    dataUrl = canvas.toDataURL(mimeType, quality);
  }
  return dataUrl;
}

function encodeCanvasAsJpegWithBackdrop(canvas: HTMLCanvasElement, mode: EditImageQualityMode): string {
  const flattened = document.createElement('canvas');
  flattened.width = canvas.width;
  flattened.height = canvas.height;
  const ctx = flattened.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/jpeg', EDIT_IMAGE_JPEG_QUALITY);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flattened.width, flattened.height);
  ctx.drawImage(canvas, 0, 0);
  return encodeCanvasForGemini(flattened, 'image/jpeg', mode);
}

export async function processImageDataUrl(dataUrl: string, fileName: string, mode: EditImageQualityMode = 'single'): Promise<ImageState> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const inputMimeType = getMimeTypeFromDataUrl(dataUrl, 'image/jpeg');
      const originalBase64 = dataUrl.split(',')[1] || '';
      const originalBytes = estimateBase64Bytes(originalBase64);
      const highFidelitySize = getHighFidelityEditSize(img.width, img.height, mode);
      const limits = EDIT_IMAGE_LIMITS[mode];

      if (
        !highFidelitySize.resized &&
        passthroughMimeTypes.has(inputMimeType) &&
        originalBytes <= limits.maxInlineBytes
      ) {
        resolve({
          fileName,
          base64: originalBase64,
          mimeType: inputMimeType,
          width: img.width,
          height: img.height,
        });
        return;
      }

      const canvas = document.createElement('canvas');
      const { width, height } = highFidelitySize;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Failed to get canvas context."));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const outputMimeType = inputMimeType === 'image/png'
        ? 'image/png'
        : inputMimeType === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg';
      let resizedDataUrl = encodeCanvasForGemini(canvas, outputMimeType, mode);
      let base64 = resizedDataUrl.split(',')[1] || '';
      if (estimateBase64Bytes(base64) > limits.maxInlineBytes && outputMimeType !== 'image/jpeg') {
        resizedDataUrl = encodeCanvasAsJpegWithBackdrop(canvas, mode);
        base64 = resizedDataUrl.split(',')[1] || '';
      }

      resolve({
        fileName,
        base64,
        mimeType: getMimeTypeFromDataUrl(resizedDataUrl, outputMimeType),
        width: Math.round(width),
        height: Math.round(height),
      });
    };
    img.onerror = () => reject(new Error(`Could not load the image file preview for ${fileName}. It may be corrupt or an unsupported format.`));
    img.src = dataUrl;
  });
}

/**
 * Processes an uploaded image file.
 * Resizes and compresses the image to ensure the payload stays within 
 * reasonable limits for the API and proxy (preventing 502 errors).
 * @param file The image file to process (e.g., JPG, PNG, WebP).
 * @returns A promise that resolves to an ImageState object.
 */
export async function processAndResizeImage(file: File, mode: EditImageQualityMode = 'single'): Promise<ImageState> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                if (!e.target?.result) {
                    return reject(new Error("Failed to read file."));
                }
                processImageDataUrl(e.target.result as string, file.name, mode).then(resolve).catch(reject);

            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = () => reject(new Error("Failed to read file."));
        reader.readAsDataURL(file);
    });
}

export async function detectTransferableElements(base64Image: string, mimeType = 'image/jpeg'): Promise<StyleCategory[]> {
    const base64Hash = await hashString(base64Image);
    const cacheKey = `gemini_cache_detectTransferableElements_${base64Hash}`;
    const cachedResult = getFromCache(cacheKey);
    if (cachedResult) return cachedResult;

    const imagePart = fileToGenerativePart(base64Image, mimeType);
    const prompt = `Analyze the provided reference image with microscopic detail. Your objective is to deconstruct its visual DNA into a comprehensive, categorized list of every transferable stylistic and content element. You must identify specific, direct elements (e.g., specific patterns, lighting setups, color combinations, textures) that can be directly mapped and transferred. Do not just describe concepts or ideas; extract the concrete visual components that constitute the style. Be exhaustive.

For each element you identify, provide:
1.  A concise 'label'.
2.  A simple one-sentence 'description'.
3.  A 'confidence' score ('high', 'medium', 'low').

Categorize your findings into the specific categories defined below. You MUST use the provided 'id' and 'label' exactly as specified. The labels have been shortened for UI optimization.

- **Category ID: "color_palette", Label: "Colors"**: The overall color scheme, harmony, temperature, and grading.
- **Category ID: "lighting", Label: "Lighting"**: The lighting style, quality, direction, and shadows.
- **Category ID: "mood_atmosphere", Label: "Mood"**: The overall emotional tone, atmosphere, or feeling.
- **Category ID: "spatial_dna", Label: "Spatial DNA"**: The precise spatial layout, positioning of background objects, and depth relationships.
- **Category ID: "subject_style", Label: "Style"**: The rendering style of the subject (e.g., Photorealistic, Painterly, sketch).
- **Category ID: "composition", Label: "Framing"**: Compositional techniques, framing, and perspective.
- **Category ID: "texture_patterns", Label: "Texture"**: Surface textures, grain, or repeating patterns.
- **Category ID: "medium_emulation", Label: "Medium"**: Art medium emulation (e.g., Oil painting, Polaroid, 3D render).
- **Category ID: "post_processing", Label: "Effects"**: Global post-processing effects (e.g., Film grain, Vignette, Glow).
- **Category ID: "camera_lens_effects", Label: "Optics"**: Distinct lens effects (e.g., Bokeh, Flare, Distortion).
- **Category ID: "hair_style", Label: "Hair"**: Hairstyle, color, and texture (if people are present).
- **Category ID: "clothing_style", Label: "Clothing"**: Clothing style, fabric, and fit (if people are present).
- **Category ID: "accessories", Label: "Accessory"**: Accessories like jewelry, hats, glasses.
- **Category ID: "subject_additions", Label: "Additions"**: Tattoos, makeup, or props held by subject.
- **Category ID: "foreground_elements", Label: "Foreground"**: Distinct foreground elements, including specific objects, props, or items placed in the foreground.
- **Category ID: "background_elements", Label: "Background"**: Background setting, environment, location, and atmosphere.
- **Category ID: "text_styles", Label: "Typography"**: Typography style, font, placement, color, and effects (e.g., shadows, outlines). You MUST also include an item with id "add_custom_text", label "Add Custom Text", description "Add new text not present in the reference.", and confidence "high".

**CRITICAL INSTRUCTION FOR 'checked' PROPERTY:**
- **CHECKED (true):** Only set 'checked' to TRUE for elements in these categories: \`color_palette\`, \`lighting\`, \`mood_atmosphere\`, \`spatial_dna\`, \`background_elements\`, \`foreground_elements\`, \`post_processing\`, and \`camera_lens_effects\`.
- **UNCHECKED (false):** Set 'checked' to FALSE for ALL OTHER categories.

Return the result as a JSON object that strictly adheres to the provided schema.`;

    const schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                id: { type: Type.STRING },
                label: { type: Type.STRING },
                items: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            label: { type: Type.STRING },
                            description: { type: Type.STRING },
                            confidence: { type: Type.STRING },
                            checked: { type: Type.BOOLEAN },
                        },
                        required: ['id', 'label', 'description', 'confidence', 'checked'],
                    },
                },
            },
            required: ['id', 'label', 'items'],
        },
    };

    const response = await generateAnalysis(
      { parts: [imagePart, { text: prompt }] },
      {
          responseMimeType: "application/json",
          responseSchema: schema,
      },
      'reference analysis',
    );

    const resultText = getResponseText(response);
    let parsedResult: any[];
    try {
        parsedResult = JSON.parse(resultText);
        if (!Array.isArray(parsedResult)) {
            throw new Error("AI response is not an array.");
        }
    } catch (e) {
        console.error("Failed to parse AI response:", resultText);
        throw new Error("Could not understand the AI's analysis. Please try a different reference image.");
    }

    const result = parsedResult.map((category: any): StyleCategory => ({
        id: category.id || `category-${Math.random()}`,
        label: category.label || "Untitled",
        items: (category.items || []).map((item: any): StyleSubItem => ({
            id: item.id || `item-${Math.random()}`,
            label: item.label || "Untitled Item",
            description: item.description || "",
            confidence: item.confidence || "low",
            checked: item.checked ?? false,
        })),
        intensity: 50,
    }));
    
    saveToCache(cacheKey, result);
    return result;
}

/**
 * Analyzes a reference image to create a scene blueprint for consistency.
 */
export async function analyzeReferenceScene(base64Image: string, mimeType = 'image/jpeg'): Promise<string> {
  const base64Hash = await hashString(base64Image);
  const cacheKey = `gemini_cache_analyzeReferenceScene_${base64Hash}`;
  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) return cachedResult;

  const imagePart = fileToGenerativePart(base64Image, mimeType);
  const prompt = `Perform a deep forensic analysis of this reference image to extract its "Visual DNA" and "Spatial Blueprint". 
  Your goal is to provide a technical specification that allows another artist to perfectly replicate the look, feel, and layout.
  
  Focus on:
  - **Atmospheric DNA:** Describe the exact "feel" of the air (haze, clarity, humidity, dust, light rays).
  - **Lighting DNA:** Map the precise lighting setup. Identify key, fill, and rim lights. Note the exact color temperature (e.g., "5600K cool daylight" or "2700K warm tungsten").
  - **Reflections & Specularity DNA:** Analyze how light reflects off surfaces. Identify the type of reflections (sharp, blurry, distorted) and the specularity of different materials (e.g., "high-gloss floor", "matte skin", "metallic sheen"). Note any specific environmental reflections (e.g., "sky reflected in water", "light source reflected in eyes").
  - **Spatial Blueprint:** Describe the position and scale of key background and foreground objects. Note their depth and relationship to each other.
  - **Material & Texture DNA:** Identify the dominant materials (e.g., "brushed aluminum", "wet asphalt", "soft velvet") and their specific textures.
  - **Color DNA:** Define the primary, secondary, and accent colors, including their saturation and luminance levels.
  
  This blueprint is the "Source of Truth" for the scene. Be forensic, technical, and exhaustive.`;

  const response = await generateAnalysis({ parts: [imagePart, { text: prompt }] }, undefined, 'reference scene analysis');

  const result = getResponseText(response);
  saveToCache(cacheKey, result);
  return result;
}

/**
 * Generates a detailed text analysis of a target image's content.
 */
export async function analyzeTargetImageDetails(base64Image: string, mimeType = 'image/jpeg'): Promise<string> {
  const base64Hash = await hashString(base64Image);
  const cacheKey = `gemini_cache_analyzeTargetImageDetails_v2_${base64Hash}`;
  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) return cachedResult;

  const imagePart = fileToGenerativePart(base64Image, mimeType);
  const prompt = `Analyze the target image and provide a factual description of its core content for geometric locking and subject-lit outpainting.
  - **Pose:** Describe subject's pose, head tilt, chin height, shoulder alignment.
  - **Identity:** Describe facial landmarks (nose, jawline, eyes, teeth, skin tone).
  - **Expression:** Describe facial expression.
  - **Details:** Hair, clothing, accessories, setting.
  - **Subject Lighting Blueprint:** Describe the lighting already visible on the subject: key-light direction, fill strength, rim light, shadow side, catchlights, color temperature, contrast ratio, and any color bleed on skin/clothing.
  - **Scene Lighting Inference:** State what kind of environment would naturally create that lighting on this subject.
  Be concise and forensic.`;
  
  const response = await generateAnalysis({ parts: [imagePart, { text: prompt }] }, undefined, 'target image analysis');

  const result = getResponseText(response);
  saveToCache(cacheKey, result);
  return result;
}

/**
 * Analyzes an image of a clothing item and returns a text description.
 */
export async function analyzeClothingImage(base64Image: string, mimeType = 'image/jpeg'): Promise<string> {
  const base64Hash = await hashString(base64Image);
  const cacheKey = `gemini_cache_analyzeClothingImage_${base64Hash}`;
  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) return cachedResult;

  const imagePart = fileToGenerativePart(base64Image, mimeType);
  const prompt = "Describe the clothing item in this image in detail. Focus on the type of clothing (e.g., 'a blue denim jacket'), its material, fit, color, and any patterns or logos. Be concise and descriptive, as if instructing an artist. Example: 'A vintage, slightly oversized, faded blue denim jacket with copper buttons and a small tear on the left sleeve.'";

  const response = await generateAnalysis({ parts: [imagePart, { text: prompt }] }, undefined, 'clothing analysis');

  const result = getResponseText(response);
  saveToCache(cacheKey, result);
  return result;
}

/**
 * Analyzes an image of an accessory item and returns a text description.
 */
export async function analyzeAccessoryImage(base64Image: string, mimeType = 'image/jpeg'): Promise<string> {
  const base64Hash = await hashString(base64Image);
  const cacheKey = `gemini_cache_analyzeAccessoryImage_${base64Hash}`;
  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) return cachedResult;

  const imagePart = fileToGenerativePart(base64Image, mimeType);
  const prompt = "Describe the accessory item in this image in detail. Focus on the type of accessory (e.g., 'a gold necklace', 'a black fedora hat', 'aviator sunglasses'), its material, style, color, and any distinct features. Be concise and descriptive. Example: 'A delicate, thin 18k gold chain necklace with a small circular pendant.'";

  const response = await generateAnalysis({ parts: [imagePart, { text: prompt }] }, undefined, 'accessory analysis');

  const result = getResponseText(response);
  saveToCache(cacheKey, result);
  return result;
}

/**
 * Analyzes an image of a face and returns a detailed text description of its features.
 */
export async function analyzeFaceImage(base64Image: string, mimeType = 'image/jpeg'): Promise<string> {
  const base64Hash = await hashString(base64Image);
  const cacheKey = `gemini_cache_analyzeFaceImage_${base64Hash}`;
  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) return cachedResult;

  const imagePart = fileToGenerativePart(base64Image, mimeType);
  const prompt = "Describe the key facial features of the person in this image in detail. Focus on face shape (e.g., oval, square), eye color and shape (e.g., almond-shaped, blue), nose shape (e.g., button nose, prominent bridge), lip shape (e.g., full, thin), and any distinctive features like freckles, dimples, or specific eyebrow shape. Be concise and descriptive, as if instructing a portrait artist. Example: 'An oval face with high cheekbones, deep-set green eyes, a straight nose, and full lips. She has light freckles across her nose and cheeks.'";

  const response = await generateAnalysis({ parts: [imagePart, { text: prompt }] }, undefined, 'face analysis');

  const result = getResponseText(response);
  saveToCache(cacheKey, result);
  return result;
}

/**
 * Analyzes an image of a background/scene and returns a detailed text description.
 */
export async function analyzeBackgroundImage(base64Image: string, mimeType = 'image/jpeg'): Promise<string> {
  const base64Hash = await hashString(base64Image);
  const cacheKey = `gemini_cache_analyzeBackgroundImage_${base64Hash}`;
  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) return cachedResult;

  const imagePart = fileToGenerativePart(base64Image, mimeType);
  const prompt = `Perform a professional, VFX-level forensic lighting and scene analysis on the provided background image. The goal is to create a comprehensive "lighting and integration blueprint" for a photorealistic composite. Your analysis MUST be structured as a bulleted list, covering these specific points with extreme technical detail:
- **Environment:** A one-sentence description of the scene (e.g., 'A sun-drenched, sandy beach at golden hour.').
- **Primary Light Source (Key Light):** Describe the main light. Include its direction (e.g., 'from high top-right'), quality (e.g., 'Hard, direct sunlight with sharp specularity' or 'Soft, heavily diffused light from a large overcast sky'), and color temperature (e.g., 'Warm, golden light, approx 3500K').
- **Secondary & Ambient Light (Fill/Global Illumination):** Describe the indirect environmental light. Include its dominant color (e.g., 'Bright, cool blue skylight') and intensity relative to the key light (e.g., 'Low-intensity fill'). Note any secondary light sources.
- **Shadow Properties:** Describe the shadows cast. Include their sharpness/penumbra (e.g., 'Hard-edged, high-contrast shadows with minimal softness' or 'Very soft, diffuse contact shadows'), and color (e.g., 'Deep blue, saturated shadows due to skylight fill'). Mention contact occlusion.
- **Environmental Color Bleed:** Describe how environmental colors reflect onto objects. Be specific (e.g., 'The green grass casts a subtle, low-saturation green bounce light onto the lower-facing surfaces of objects.').
- **Atmospherics & Depth:** Describe any haze, fog, or atmospheric perspective that affects distant objects. Note the image's overall sharpness and depth of field. (e.g., 'Slight atmospheric haze causing distant objects to appear lower in contrast and bluer. Shallow depth of field with a soft background bokeh.').
- **Lighting Essence:** Conclude with a single sentence that captures the overall artistic and emotional mood the lighting creates. This is the guiding principle for the final composite. (e.g., 'The lighting essence is a hazy, late-afternoon dream.' or 'The lighting essence is harsh and cold, creating a sense of urban isolation.').

Your output must be this structured list. Be as precise as a professional 3D lighting artist.`;

  const response = await generateAnalysis({ parts: [imagePart, { text: prompt }] }, undefined, 'background analysis');

  const result = getResponseText(response);
  saveToCache(cacheKey, result);
  return result;
}

/**
 * Analyzes an image of a sky and returns a detailed text description.
 */
export async function analyzeSkyImage(base64Image: string, mimeType = 'image/jpeg'): Promise<string> {
  const base64Hash = await hashString(base64Image);
  const cacheKey = `gemini_cache_analyzeSkyImage_${base64Hash}`;
  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) return cachedResult;

  const imagePart = fileToGenerativePart(base64Image, mimeType);
  const prompt = `Analyze this sky image for the purpose of a photorealistic sky replacement. Describe the following in detail:
  - **Cloud Structure:** Type, density, altitude (e.g., wispy cirrus, dramatic cumulonimbus, clear blue).
  - **Lighting & Color:** Sun position (implied), color temperature (e.g., golden hour warm, noon cool), gradient shifts from horizon to zenith.
  - **Atmospherics:** Haze, fog, clarity.
  - **Overall Mood:** (e.g., stormy, serene, vibrant sunset).
  
  Provide a concise, descriptive paragraph that acts as a blueprint for generating/compositing this exact sky.`;

  const response = await generateAnalysis({ parts: [imagePart, { text: prompt }] }, undefined, 'sky analysis');

  const result = getResponseText(response);
  saveToCache(cacheKey, result);
  return result;
}

/**
 * Analyzes a set of images to extract a consistent "Visual DNA" for a digital twin.
 */
export async function analyzeTwinImages(images: ImageState[]): Promise<string> {
  const imageHashes = await Promise.all(images.map(img => hashString(img.base64!)));
  const cacheKey = `gemini_cache_analyzeTwinImages_${imageHashes.join('')}`;
  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) return cachedResult;

  const imageParts = images.map(img => fileToGenerativePart(img.base64!, img.mimeType!));
  const prompt = `Analyze this set of images of the same subject. Your goal is to extract a consistent "Visual DNA" that defines this subject's unique appearance across different environments and poses.
  
  Focus on identifying:
  - **Facial Structure:** Bone structure, face shape, jawline, forehead.
  - **Key Features:** Eyes (color, shape, distance), nose (bridge, tip), lips (fullness, shape), ears.
  - **Distinctive Marks:** Freckles, moles, scars, dimples, tattoos.
  - **Hair DNA:** Natural color, texture, typical style, hairline.
  - **Build & Proportions:** Overall body type, height (estimated), neck length, shoulder width.
  
  Provide a highly detailed, technical description that acts as a "Master Blueprint" for this subject. This description will be used to maintain perfect consistency when generating new images of this person.`;

  const response = await generateAnalysis({ parts: [...imageParts, { text: prompt }] }, undefined, 'digital twin analysis');

  const result = getResponseText(response);
  saveToCache(cacheKey, result);
  return result;
}


/**
 * Edits an image based on a detailed text prompt using the image-in, image-out model.
 */
export async function evaluateRealism(generatedBase64: string, generatedMimeType: string, targetBase64: string, targetMimeType: string): Promise<'realistic' | 'slightly off'> {
  try {
    const prompt = `
You are an expert photography and compositing judge.
I am providing you with two images:
1. The original target image (Image 1)
2. The generated composite image (Image 2)

Your task is to evaluate the REALISM of the generated image (Image 2).
Focus on:
- Lighting match (do the shadows and highlights make sense in the new environment?)
- Grounding (does the subject look like they are floating, or are they planted firmly?)
- Edge blending (are there harsh cut-out lines or halos?)
- Scale and perspective (does the subject's size make sense?)

Respond with ONLY ONE of the following two phrases:
"realistic" - if the image looks like a genuine, unedited photograph with good compositing.
"slightly off" - if there are noticeable compositing errors, floating subjects, mismatched lighting, or AI artifacts.
`;

    const response = await generateAnalysis(
      {
        parts: [
          { inlineData: { data: targetBase64, mimeType: targetMimeType } },
          { inlineData: { data: generatedBase64, mimeType: generatedMimeType } },
          { text: prompt }
        ],
      },
      {
        temperature: 0.1,
      },
      'realism evaluation',
    );

    const text = getResponseText(response).toLowerCase();
    if (text.includes('slightly off')) {
      return 'slightly off';
    }
    return 'realistic';
  } catch (error) {
    console.error("Error evaluating realism:", error);
    return 'realistic'; // Default to realistic on error to avoid breaking the UI
  }
}

export async function editImage(
    imageParts: { inlineData: { data: string, mimeType: string }}[], 
    prompt: string,
    aspectRatio?: AspectRatio,
    seed?: number
): Promise<string> {
  const inlineBytes = imageParts.reduce((total, part) => total + estimateBase64Bytes(part.inlineData.data), 0);
  const promptBytes = new TextEncoder().encode(prompt).byteLength;
  if (inlineBytes + promptBytes > MAX_INLINE_REQUEST_BYTES) {
    throw new Error("This edit is too large to send efficiently. Remove extra reference assets or use fewer/lower-resolution images, then try again.");
  }

  const textPart = { text: prompt };
  
  const { response } = await generateImageEditWithFallback({ parts: [...imageParts, textPart] }, aspectRatio, seed);

  const editedImagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
  if (editedImagePart?.inlineData) {
    return editedImagePart.inlineData.data;
  }
  
  const textResponse = getResponseText(response);
  console.error("Image generation failed. Model response:", textResponse);
  throw new Error(`AI failed to return an edited image. Reason: ${textResponse || "No reason provided."}`);
}
