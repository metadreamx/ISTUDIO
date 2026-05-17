
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircleIcon, CameraIcon, FolderOpenIcon, PlayIcon, RadioIcon, RefreshCwIcon, SettingsIcon, SquareIcon as StopIcon } from 'lucide-react';
import type { ImageState, StyleCategory, HistoryItem, BatchImage, CustomClothingItem, CustomAccessoryItem, CustomFaceItem, CustomBackgroundItem, CustomSkyItem, AspectRatio, Project, ProjectStorageMode, TetherCapture, TetherProjectState, TetherStatus } from '../types';
import { ImageUploader } from './ImageUploader';
import { MainPanel } from './MainPanel';
import { StyleChecklist } from './StyleChecklist';
import { analyzeTargetImageDetails, editImage, detectTransferableElements, analyzeClothingImage, analyzeAccessoryImage, analyzeFaceImage, analyzeBackgroundImage, analyzeSkyImage, analyzeReferenceScene } from '../services/geminiService';
import { getTetherStatus, saveProjectAsset, selectTetherFolder, startTetherSession, stopTetherSession } from '../services/db';
import { getImageSrc, hasImageSource, imageToGeminiInput } from '../services/imageAssets';
import { SparklesIcon, XCircleIcon, CheckIcon, LockIcon, HistoryIcon, DownloadIcon, ChevronDownIcon } from '@/components/icons';

// Utility function to get dominant color from an image
const getDominantColor = (base64Image: string, mimeType: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject('Could not get canvas context');
      }
      const size = 50;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);

      const data = ctx.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0;
      let count = 0;

      for (let i = 0; i < data.length; i += 4) {
        const lightness = (data[i] + data[i+1] + data[i+2]) / 3;
        const saturation = Math.max(data[i], data[i+1], data[i+2]) - Math.min(data[i], data[i+1], data[i+2]);

        if (lightness > 25 && lightness < 230 && saturation > 20) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
        }
      }
      
      if (count < 10) {
        resolve('rgb(212, 175, 55)');
        return;
      }

      r = Math.floor(r / count);
      g = Math.floor(g / count);
      b = Math.floor(b / count);
      
      resolve(`rgb(${r}, ${g}, ${b})`);
    };
    img.onerror = (err) => {
        console.error("Image load error for dominant color", err);
        reject('Image load error');
    };
    img.src = `data:${mimeType};base64,${base64Image}`;
  });
};

const sourceToInlineData = async (source: string, fallbackMimeType = 'image/png') => {
  const dataUrl = source.startsWith('data:')
    ? source
    : await new Promise<string>(async (resolve, reject) => {
        try {
          const response = await fetch(source);
          if (!response.ok) throw new Error(`Could not load saved image (${response.status}).`);
          const blob = await response.blob();
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Could not read saved image.'));
          reader.readAsDataURL(blob);
        } catch (error) {
          reject(error);
        }
      });
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return {
    data: match?.[2] || dataUrl.split(',')[1] || '',
    mimeType: match?.[1] || fallbackMimeType,
  };
};

type GenerationStatus = 'idle' | 'analyzing_target' | 'generating' | 'saving';

interface StyleTransferViewProps {
    project: Project | null;
    onUpdateProject: (project: Project) => void;
    onCreateProject?: (name: string, initialState?: Project['state']) => Promise<Project | null>;
    referenceTemplate?: ImageState | null;
    onReferenceTemplateConsumed?: () => void;
    storageMode?: ProjectStorageMode;
}

const createEmptyImage = (): ImageState => ({ fileName: null, base64: null, mimeType: null });

const createInitialItems = (prefix: string, gender: 'man' | 'woman', count: number): any[] => Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${gender}-${i}`,
    image: { fileName: null, base64: null, mimeType: null },
    analysis: null,
    enabled: false,
    status: 'empty'
}));

const createInitialFaceItem = (): CustomFaceItem => ({
    image: { fileName: null, base64: null, mimeType: null },
    analysis: null,
    enabled: false,
    status: 'empty'
});

const createInitialBackgroundItem = (): CustomBackgroundItem => ({
    image: { fileName: null, base64: null, mimeType: null },
    analysis: null,
    enabled: false,
    status: 'empty'
});

const createInitialSkyItem = (): CustomSkyItem => ({
    image: { fileName: null, base64: null, mimeType: null },
    analysis: null,
    enabled: false,
    status: 'empty'
});

const REFERENCE_ANALYSIS_TIMEOUT_MS = 75000;
const COLOR_ANALYSIS_TIMEOUT_MS = 12000;

const withReferenceAnalysisTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} took too long. ISTUDIO loaded starter DNA controls instead.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const createFallbackReferenceChecklist = (): StyleCategory[] => ([
  {
    id: 'color_palette',
    label: 'Colors',
    intensity: 50,
    items: [
      { id: 'fallback-color-temperature', label: 'Color temperature', description: 'Match the overall warm, cool, or neutral color balance from the reference.', confidence: 'medium', checked: true },
      { id: 'fallback-color-grade', label: 'Color grade', description: 'Carry over the reference image contrast, saturation, and tonal palette.', confidence: 'medium', checked: true },
    ],
  },
  {
    id: 'lighting',
    label: 'Lighting',
    intensity: 50,
    items: [
      { id: 'fallback-light-direction', label: 'Light direction', description: 'Match the key light direction and shadow side from the reference.', confidence: 'medium', checked: true },
      { id: 'fallback-light-quality', label: 'Light quality', description: 'Match the softness, contrast ratio, highlights, and falloff from the reference.', confidence: 'medium', checked: true },
    ],
  },
  {
    id: 'mood_atmosphere',
    label: 'Mood',
    intensity: 50,
    items: [
      { id: 'fallback-atmosphere', label: 'Atmosphere', description: 'Transfer the scene mood, air, haze, polish, and editorial feeling.', confidence: 'medium', checked: true },
    ],
  },
  {
    id: 'spatial_dna',
    label: 'Spatial DNA',
    intensity: 50,
    items: [
      { id: 'fallback-depth-layout', label: 'Depth and layout', description: 'Use the reference depth, background spacing, perspective, and environmental structure.', confidence: 'medium', checked: true },
    ],
  },
  {
    id: 'background_elements',
    label: 'Background',
    intensity: 50,
    items: [
      { id: 'fallback-background-environment', label: 'Environment', description: 'Replace or restyle the background using the reference environment and scene language.', confidence: 'medium', checked: true },
    ],
  },
  {
    id: 'post_processing',
    label: 'Effects',
    intensity: 50,
    items: [
      { id: 'fallback-finish', label: 'Final finish', description: 'Match the reference image finishing, contrast, glow, grain, and lens polish.', confidence: 'medium', checked: true },
    ],
  },
]);

const createFallbackReferenceBlueprint = (): string => [
  'Starter Visual DNA Blueprint:',
  '- Analyze the reference image directly while generating and transfer its visible background, lighting direction, color temperature, mood, depth, and finish.',
  '- Keep the target subject geometry stable while replacing or restyling the surrounding scene according to the selected DNA controls.',
  '- Use the target subject lighting as a physical guide so the generated environment feels naturally connected to the subject.',
].join('\n');

const compactHistoryImage = (image: ImageState | undefined, fallbackFileName: string | null = null): ImageState => ({
  fileName: image?.fileName || fallbackFileName,
  base64: null,
  mimeType: image?.mimeType || null,
  width: image?.width ?? null,
  height: image?.height ?? null,
  assetPath: image?.assetPath ?? null,
  assetUrl: image?.assetUrl ?? null,
});

const compactHistoryForSave = (history: HistoryItem[], fallbackReference: ImageState): HistoryItem[] =>
  history.map((item) => ({
    ...item,
    target: compactHistoryImage(item.target, item.targetFileName || null),
    reference: compactHistoryImage(item.reference, fallbackReference.fileName),
  }));

export const StyleTransferView: React.FC<StyleTransferViewProps> = ({ project, onUpdateProject, onCreateProject, referenceTemplate, onReferenceTemplateConsumed, storageMode = 'folder' }) => {
  const [referenceImage, setReferenceImage] = useState<ImageState>(createEmptyImage());
  const [targetImages, setTargetImages] = useState<BatchImage[]>([]);
  const [generationHistory, setGenerationHistory] = useState<HistoryItem[]>([]);
  const [isGenerationHistoryOpen, setIsGenerationHistoryOpen] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState<number>(-1);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<StyleCategory[]>([]);
  const [sceneBlueprint, setSceneBlueprint] = useState<string | null>(null);
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio | undefined>(undefined);
  const [sessionSeed, setSessionSeed] = useState<number | null>(null);
  const [anchorImageId, setAnchorImageId] = useState<string | null>(null);
  const cancelGenerationRef = useRef(false);
  const lastAnalyzedRefBase64 = useRef<string | null>(null);
  const generationHistoryMenuRef = useRef<HTMLDivElement | null>(null);
  
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [tetherStatus, setTetherStatus] = useState<TetherStatus | null>(null);
  const [tetherFolderPath, setTetherFolderPath] = useState('');
  const [tetherAutoEdit, setTetherAutoEdit] = useState(false);
  const [tetherProjectMode, setTetherProjectMode] = useState<'current' | 'new'>(project ? 'current' : 'new');
  const [isTetherPanelOpen, setIsTetherPanelOpen] = useState(false);
  const [isTetherBusy, setIsTetherBusy] = useState(false);
  const importedTetherCaptureIdsRef = useRef<Set<string>>(new Set());
  const isRefreshingTetherStatusRef = useRef(false);
  const isBrowserStorage = storageMode === 'browser';

  // State for custom clothing feature
  const [customClothingItems, setCustomClothingItems] = useState({
    woman: createInitialItems('clothing', 'woman', 2) as CustomClothingItem[],
    man: createInitialItems('clothing', 'man', 2) as CustomClothingItem[],
  });
  
  // State for custom accessory feature
  const [customAccessoryItems, setCustomAccessoryItems] = useState({
    woman: createInitialItems('accessory', 'woman', 2) as CustomAccessoryItem[],
    man: createInitialItems('accessory', 'man', 2) as CustomAccessoryItem[],
  });
  
  // State for custom face feature
  const [customFaceItems, setCustomFaceItems] = useState({
    woman: createInitialFaceItem(),
    man: createInitialFaceItem(),
  });

  // State for custom background feature
  const [customBackgroundItem, setCustomBackgroundItem] = useState(createInitialBackgroundItem());

  // State for custom sky feature
  const [customSkyItem, setCustomSkyItem] = useState(createInitialSkyItem());

  const hasReadyGenerationInstructions = useCallback(() => {
    const hasSelectedCategory = checklist.some((category) =>
      category.intensity > 0 && (category.items.some((item) => item.checked) || Boolean(category.customPrompt)),
    );
    const hasCustomClothing = [...customClothingItems.man, ...customClothingItems.woman].some((item) => item.enabled && item.status === 'ready');
    const hasCustomAccessory = [...customAccessoryItems.man, ...customAccessoryItems.woman].some((item) => item.enabled && item.status === 'ready');
    const hasCustomFace = [customFaceItems.man, customFaceItems.woman].some((item) => item.enabled && item.status === 'ready');
    const hasCustomBackground = customBackgroundItem.enabled && customBackgroundItem.status === 'ready';
    const hasCustomSky = customSkyItem.enabled && customSkyItem.status === 'ready';

    return hasSelectedCategory || hasCustomClothing || hasCustomAccessory || hasCustomFace || hasCustomBackground || hasCustomSky;
  }, [
    checklist,
    customAccessoryItems,
    customBackgroundItem,
    customClothingItems,
    customFaceItems,
    customSkyItem,
  ]);

  const canAutoQueueTether = Boolean(hasImageSource(referenceImage) && referenceImage.mimeType && !isAnalyzing && hasReadyGenerationInstructions());

  // Load project state
  useEffect(() => {
    const state = project?.state || {};
    const nextReference = state.referenceImage || createEmptyImage();
    const restoredHistory: HistoryItem[] = Array.isArray(state.generationHistory)
      ? state.generationHistory
      : [];
    const generatedByTargetId = new Map<string, string>();
    restoredHistory.forEach((item) => {
      if (item.targetId && item.generated && !generatedByTargetId.has(item.targetId)) {
        generatedByTargetId.set(item.targetId, item.generated);
      }
    });
    const restoredTargets: BatchImage[] = Array.isArray(state.targetImages)
      ? state.targetImages.map((img: BatchImage) => {
          const restoredGenerated = img.generated || generatedByTargetId.get(img.id) || null;
          return {
            ...img,
            generated: restoredGenerated,
            status: (img.status === 'queued' || img.status === 'processing')
              ? 'pending'
              : restoredGenerated && img.status !== 'error'
                ? 'done'
                : img.status,
          };
        })
      : [];
    const fallbackHistory: HistoryItem[] = restoredHistory.length > 0
      ? restoredHistory
      : restoredTargets
          .filter((img) => img.generated)
          .map((img, index) => ({
            id: Number(project?.createdAt || Date.now()) + index,
            projectId: project?.id || 'live-session',
            generated: img.generated!,
            target: img.target,
            reference: nextReference,
            targetId: img.id,
            targetFileName: img.target.fileName,
          }));

    setReferenceImage(nextReference);
    lastAnalyzedRefBase64.current = nextReference.assetPath || nextReference.assetUrl || nextReference.base64 || null;
    setTargetImages(restoredTargets);
    setGenerationHistory(fallbackHistory);
    setActiveImageIndex(restoredTargets.length > 0 ? 0 : -1);
    setChecklist(Array.isArray(state.checklist) ? state.checklist : []);
    setSceneBlueprint(state.sceneBlueprint || null);
    setAccentColor(state.accentColor || null);
    setAspectRatio(state.aspectRatio || undefined);
    setCustomClothingItems(state.customClothingItems || {
      woman: createInitialItems('clothing', 'woman', 2) as CustomClothingItem[],
      man: createInitialItems('clothing', 'man', 2) as CustomClothingItem[],
    });
    setCustomAccessoryItems(state.customAccessoryItems || {
      woman: createInitialItems('accessory', 'woman', 2) as CustomAccessoryItem[],
      man: createInitialItems('accessory', 'man', 2) as CustomAccessoryItem[],
    });
    setCustomFaceItems(state.customFaceItems || {
      woman: createInitialFaceItem(),
      man: createInitialFaceItem(),
    });
    setCustomBackgroundItem(state.customBackgroundItem || createInitialBackgroundItem());
    setCustomSkyItem(state.customSkyItem || createInitialSkyItem());
    setSessionSeed(typeof state.sessionSeed === 'number' ? state.sessionSeed : null);
    setAnchorImageId(typeof state.anchorImageId === 'string' ? state.anchorImageId : null);
    setSelectedImageIds(new Set());
    const tetherState: TetherProjectState = state.tether || {};
    setTetherFolderPath(typeof tetherState.folderPath === 'string' ? tetherState.folderPath : '');
    setTetherAutoEdit(Boolean(tetherState.autoEdit));
    setTetherProjectMode(project ? 'current' : 'new');
    importedTetherCaptureIdsRef.current = new Set(Array.isArray(tetherState.importedCaptureIds) ? tetherState.importedCaptureIds : []);
    setIsGenerationHistoryOpen(false);
    setGenerationStatus('idle');
    setError(null);
  }, [project?.id]); // Only re-load when project ID changes

  useEffect(() => {
    if (!isGenerationHistoryOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && generationHistoryMenuRef.current?.contains(target)) {
        return;
      }
      setIsGenerationHistoryOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsGenerationHistoryOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isGenerationHistoryOpen]);

  const buildProjectSnapshot = useCallback((overrides: Partial<{
    referenceImage: ImageState;
    targetImages: BatchImage[];
    checklist: StyleCategory[];
    sceneBlueprint: string | null;
    accentColor: string | null;
    aspectRatio: AspectRatio | undefined;
    customClothingItems: typeof customClothingItems;
    customAccessoryItems: typeof customAccessoryItems;
    customFaceItems: typeof customFaceItems;
    customBackgroundItem: CustomBackgroundItem;
    customSkyItem: CustomSkyItem;
    sessionSeed: number | null;
    anchorImageId: string | null;
    generationHistory: HistoryItem[];
    tether: TetherProjectState;
  }> = {}): Project | null => {
    if (!project) return null;

    const nextReferenceImage = overrides.referenceImage ?? referenceImage;
    const nextTargetImages = overrides.targetImages ?? targetImages;
    const nextGenerationHistory = overrides.generationHistory ?? generationHistory;
    const generatedImages = Array.from(new Set([
      ...nextGenerationHistory.map(item => item.generated).filter((img): img is string => !!img),
      ...nextTargetImages.map(img => img.generated).filter((img): img is string => !!img),
    ])).slice(0, 4);
    const compactTargetImages = nextTargetImages.map((image) => ({
      ...image,
      generated: null,
    }));
    const compactGenerationHistory = compactHistoryForSave(nextGenerationHistory, nextReferenceImage);

    return {
      ...project,
      lastModified: Date.now(),
      generatedImages,
      state: {
        ...(project.state || {}),
        referenceImage: nextReferenceImage,
        targetImages: compactTargetImages,
        checklist: overrides.checklist ?? checklist,
        sceneBlueprint: overrides.sceneBlueprint ?? sceneBlueprint,
        accentColor: overrides.accentColor ?? accentColor,
        aspectRatio: overrides.aspectRatio ?? aspectRatio,
        customClothingItems: overrides.customClothingItems ?? customClothingItems,
        customAccessoryItems: overrides.customAccessoryItems ?? customAccessoryItems,
        customFaceItems: overrides.customFaceItems ?? customFaceItems,
        customBackgroundItem: overrides.customBackgroundItem ?? customBackgroundItem,
        customSkyItem: overrides.customSkyItem ?? customSkyItem,
        sessionSeed: overrides.sessionSeed ?? sessionSeed,
        anchorImageId: overrides.anchorImageId ?? anchorImageId,
        generationHistory: compactGenerationHistory,
        tether: overrides.tether ?? {
          folderPath: tetherFolderPath || undefined,
          autoEdit: tetherAutoEdit,
          importedCaptureIds: Array.from(importedTetherCaptureIdsRef.current),
          activeSessionStartedAt: tetherStatus?.projectId === project.id ? tetherStatus.startedAt : null,
        },
      },
    };
  }, [
    project,
    referenceImage,
    targetImages,
    checklist,
    sceneBlueprint,
    accentColor,
    aspectRatio,
    customClothingItems,
    customAccessoryItems,
    customFaceItems,
    customBackgroundItem,
    customSkyItem,
    sessionSeed,
    anchorImageId,
    generationHistory,
    tetherFolderPath,
    tetherAutoEdit,
    tetherStatus?.projectId,
    tetherStatus?.startedAt,
  ]);

  const saveProjectNow = useCallback((overrides: Parameters<typeof buildProjectSnapshot>[0] = {}) => {
    const updatedProject = buildProjectSnapshot(overrides);
    if (updatedProject) {
      onUpdateProject(updatedProject);
    }
  }, [buildProjectSnapshot, onUpdateProject]);

  const persistProjectImage = useCallback(async (
    image: ImageState,
    bucket: 'reference' | 'targets' | 'outputs' | 'assets' | 'tether/inbox',
  ): Promise<ImageState> => {
    if (!project?.id || !image.base64) {
      return image;
    }
    try {
      return await saveProjectAsset(project.id, image, bucket);
    } catch (error) {
      console.warn(`Could not save ${bucket} image into the project folder.`, error);
      return image;
    }
  }, [project?.id]);

  useEffect(() => {
    if (!hasImageSource(referenceTemplate) || !referenceTemplate?.mimeType) return;

    let isCancelled = false;
    const applyTemplate = async () => {
      const storedReference = await persistProjectImage(referenceTemplate, 'reference');
      if (isCancelled) return;
      setReferenceImage(storedReference);
      setChecklist([]);
      setSceneBlueprint(null);
      setAccentColor(null);
      setOpenCategoryId(null);
      lastAnalyzedRefBase64.current = null;
      saveProjectNow({
        referenceImage: storedReference,
        checklist: [],
        sceneBlueprint: null,
        accentColor: null,
      });
      onReferenceTemplateConsumed?.();
    };
    applyTemplate();
    return () => {
      isCancelled = true;
    };
  }, [referenceTemplate, referenceTemplate?.assetPath, referenceTemplate?.assetUrl, referenceTemplate?.base64, referenceTemplate?.mimeType, onReferenceTemplateConsumed, persistProjectImage, saveProjectNow]);

  // Persist project state
  useEffect(() => {
    const updatedProject = buildProjectSnapshot();
    if (!updatedProject) return;

    const timer = setTimeout(() => {
      onUpdateProject(updatedProject);
    }, 1000);
    return () => clearTimeout(timer);
  }, [buildProjectSnapshot, onUpdateProject]);

  const handleReferenceImageSelect = useCallback(async (nextReferenceImage: ImageState) => {
    const storedReferenceImage = await persistProjectImage(nextReferenceImage, 'reference');
    const resetChecklist: StyleCategory[] = [];
    setReferenceImage(storedReferenceImage);
    setChecklist(resetChecklist);
    setSceneBlueprint(null);
    setAccentColor(null);
    setOpenCategoryId(null);
    lastAnalyzedRefBase64.current = null;
    saveProjectNow({
      referenceImage: storedReferenceImage,
      checklist: resetChecklist,
      sceneBlueprint: null,
      accentColor: null,
    });
  }, [persistProjectImage, saveProjectNow]);

  const handleTargetImagesSelect = useCallback(async (imageStates: ImageState[]) => {
    const newBatchImages: BatchImage[] = await Promise.all(imageStates.map(async (state, index) => {
        const dominantColor = state.base64 && state.mimeType
            ? await getDominantColor(state.base64, state.mimeType)
            : null;
        const storedTarget = await persistProjectImage(state, 'targets');
        return {
            id: `${state.fileName!}-${Date.now()}-${index}`,
            target: storedTarget,
            generated: null,
            status: 'pending' as const,
            dominantColor: dominantColor,
        };
    }));

    setTargetImages(prev => {
      const updatedImages = [...prev, ...newBatchImages];
      if (prev.length === 0 && updatedImages.length > 0) {
        setActiveImageIndex(0);
      }
      saveProjectNow({ targetImages: updatedImages });
      return updatedImages;
    });

  }, [persistProjectImage, saveProjectNow]);

  const buildTetherState = useCallback((overrides: Partial<TetherProjectState> = {}): TetherProjectState => ({
    folderPath: (overrides.folderPath ?? tetherFolderPath) || undefined,
    autoEdit: overrides.autoEdit ?? tetherAutoEdit,
    importedCaptureIds: overrides.importedCaptureIds ?? Array.from(importedTetherCaptureIdsRef.current),
    activeSessionStartedAt: overrides.activeSessionStartedAt ?? (tetherStatus?.projectId === project?.id ? tetherStatus.startedAt : null),
  }), [project?.id, tetherAutoEdit, tetherFolderPath, tetherStatus?.projectId, tetherStatus?.startedAt]);

  const buildStateForNewTetherProject = useCallback((tether: TetherProjectState) => ({
    referenceImage,
    targetImages: [],
    checklist,
    sceneBlueprint,
    accentColor,
    aspectRatio,
    customClothingItems,
    customAccessoryItems,
    customFaceItems,
    customBackgroundItem,
    customSkyItem,
    sessionSeed,
    anchorImageId: null,
    generationHistory: [],
    tether,
  }), [
    accentColor,
    aspectRatio,
    checklist,
    customAccessoryItems,
    customBackgroundItem,
    customClothingItems,
    customFaceItems,
    customSkyItem,
    referenceImage,
    sceneBlueprint,
    sessionSeed,
  ]);

  const refreshTetherStatus = useCallback(async () => {
    if (isBrowserStorage) {
      setTetherStatus({
        isWatching: false,
        folderPath: null,
        projectId: null,
        autoEdit: false,
        startedAt: null,
        message: 'Tethered Mode requires the Windows desktop app.',
        captures: [],
        supportedExtensions: [],
        rawExtensions: [],
      });
      return;
    }
    if (isRefreshingTetherStatusRef.current) return;
    isRefreshingTetherStatusRef.current = true;
    try {
      const knownCaptureIds = Array.from(importedTetherCaptureIdsRef.current)
        .filter((id): id is string => typeof id === 'string')
        .slice(-120);
      setTetherStatus(await getTetherStatus({
        includeImages: true,
        knownCaptureIds,
      }));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Could not refresh Tethered Mode status.', error);
      }
    } finally {
      isRefreshingTetherStatusRef.current = false;
    }
  }, [isBrowserStorage]);

  useEffect(() => {
    if (isBrowserStorage) return;
    refreshTetherStatus();
    const timer = window.setInterval(refreshTetherStatus, 3000);
    return () => window.clearInterval(timer);
  }, [isBrowserStorage, refreshTetherStatus]);

  const handlePickTetherFolder = useCallback(async () => {
    setIsTetherBusy(true);
    try {
      const folderPath = await selectTetherFolder();
      if (folderPath) {
        setTetherFolderPath(folderPath);
        saveProjectNow({ tether: buildTetherState({ folderPath }) });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not open the folder picker. Paste the folder path manually.');
    } finally {
      setIsTetherBusy(false);
    }
  }, [buildTetherState, saveProjectNow]);

  const handleStartTether = useCallback(async () => {
    const folderPath = tetherFolderPath.trim();
    if (!folderPath) {
      setError('Choose the folder where your camera software saves new photos.');
      return;
    }

    setIsTetherBusy(true);
    setError(null);
    try {
      const tether = buildTetherState({
        folderPath,
        autoEdit: tetherAutoEdit,
        importedCaptureIds: Array.from(importedTetherCaptureIdsRef.current),
      });
      let targetProject = project;

      if (tetherProjectMode === 'new' || !targetProject) {
        if (!onCreateProject) {
          throw new Error('Create or open a project before starting Tethered Mode.');
        }
        const timeLabel = new Date().toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
        targetProject = await onCreateProject(`Tethered Session ${timeLabel}`, buildStateForNewTetherProject(tether));
        if (!targetProject) {
          throw new Error('Could not create the tethered session project.');
        }
      } else {
        saveProjectNow({ tether });
      }

      const status = await startTetherSession({
        folderPath,
        projectId: targetProject.id,
        autoEdit: tetherAutoEdit,
      });
      setTetherStatus(status);
      setIsTetherPanelOpen(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to start Tethered Mode.');
    } finally {
      setIsTetherBusy(false);
    }
  }, [
    buildStateForNewTetherProject,
    buildTetherState,
    onCreateProject,
    project,
    saveProjectNow,
    tetherAutoEdit,
    tetherFolderPath,
    tetherProjectMode,
  ]);

  const handleStopTether = useCallback(async () => {
    setIsTetherBusy(true);
    try {
      setTetherStatus(await stopTetherSession());
      if (project) {
        saveProjectNow({ tether: buildTetherState({ activeSessionStartedAt: null }) });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to stop Tethered Mode.');
    } finally {
      setIsTetherBusy(false);
    }
  }, [buildTetherState, project, saveProjectNow]);

  const handleTetherAutoEditChange = useCallback(async (enabled: boolean) => {
    setTetherAutoEdit(enabled);
    const nextTether = buildTetherState({ autoEdit: enabled });
    saveProjectNow({ tether: nextTether });

    if (tetherStatus?.isWatching && tetherStatus.folderPath && tetherStatus.projectId === project?.id) {
      try {
        setTetherStatus(await startTetherSession({
          folderPath: tetherStatus.folderPath,
          projectId: tetherStatus.projectId,
          autoEdit: enabled,
        }));
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not update Tethered Mode.');
      }
    }
  }, [buildTetherState, project?.id, saveProjectNow, tetherStatus?.folderPath, tetherStatus?.isWatching, tetherStatus?.projectId]);

  useEffect(() => {
    if (!project?.id || !tetherStatus?.captures.length) return;

    const newCaptures = tetherStatus.captures
      .filter((capture) =>
        capture.projectId === project.id &&
        capture.status === 'imported' &&
        hasImageSource(capture.image) &&
        capture.image.mimeType &&
        !importedTetherCaptureIdsRef.current.has(capture.id),
      )
      .sort((a, b) => (a.importedAt || a.createdAt) - (b.importedAt || b.createdAt));
    if (newCaptures.length === 0) return;

    let isCancelled = false;

    const ingest = async () => {
      const newBatchImages: BatchImage[] = await Promise.all(newCaptures.map(async (capture) => {
        const image = capture.image!;
        const dominantColor = image.mimeType
          ? await imageToGeminiInput(image, 'batch')
              .then((input) => input.base64 && input.mimeType ? getDominantColor(input.base64, input.mimeType) : null)
              .catch(() => null)
          : null;
        return {
          id: `tether-${capture.id}`,
          target: {
            fileName: image.fileName || capture.fileName,
            base64: null,
            mimeType: image.mimeType,
            width: image.width ?? null,
            height: image.height ?? null,
            assetPath: image.assetPath ?? null,
            assetUrl: image.assetUrl ?? null,
          },
          generated: null,
          status: (tetherAutoEdit && canAutoQueueTether ? 'queued' : 'pending') as BatchImage['status'],
          dominantColor,
          source: 'tether',
          tetherCaptureId: capture.id,
        };
      }));

      if (isCancelled) return;

      newCaptures.forEach((capture) => importedTetherCaptureIdsRef.current.add(capture.id));
      setTargetImages((prev) => {
        const existingIds = new Set(prev.map((image) => image.id));
        const freshImages = newBatchImages.filter((image) => !existingIds.has(image.id));
        if (freshImages.length === 0) return prev;

        const updatedImages = [...prev, ...freshImages];
        setActiveImageIndex(updatedImages.length - 1);
        saveProjectNow({
          targetImages: updatedImages,
          tether: buildTetherState({ importedCaptureIds: Array.from(importedTetherCaptureIdsRef.current) }),
        });
        return updatedImages;
      });

      if (tetherAutoEdit && !canAutoQueueTether) {
        setError('Tethered photos are importing. Add a reference image and select at least one DNA control to begin auto editing.');
      }

    };

    ingest();

    return () => {
      isCancelled = true;
    };
  }, [buildTetherState, canAutoQueueTether, project?.id, saveProjectNow, tetherAutoEdit, tetherStatus?.captures]);

  useEffect(() => {
    if (!tetherAutoEdit || !canAutoQueueTether) return;

    setTargetImages((prev) => {
      let changed = false;
      const updatedImages = prev.map((image) => {
        if (image.source === 'tether' && image.status === 'pending') {
          changed = true;
          return { ...image, status: 'queued' as const };
        }
        return image;
      });
      if (changed) {
        saveProjectNow({ targetImages: updatedImages });
      }
      return changed ? updatedImages : prev;
    });
  }, [canAutoQueueTether, saveProjectNow, tetherAutoEdit]);

  useEffect(() => {
    let isCancelled = false;

    const processReferenceImage = async () => {
      const referenceKey = referenceImage.assetPath || referenceImage.assetUrl || referenceImage.base64 || null;
      if (referenceKey && referenceImage.mimeType && hasImageSource(referenceImage)) {
        // Skip analysis if we already have a checklist for this image (e.g. on project load, or replaying the same reference)
        if (checklist.length > 0 && sceneBlueprint && referenceKey === lastAnalyzedRefBase64.current) {
            return;
        }

        setIsAnalyzing(true);
        setError(null);
        setChecklist([]);
        setSceneBlueprint(null);
        setOpenCategoryId(null);
        
        try {
          const analysisImage = await imageToGeminiInput(referenceImage, 'single');
          if (!analysisImage.base64 || !analysisImage.mimeType) {
            throw new Error('Could not load the reference image from the project folder.');
          }
          const [itemsResult, colorResult, blueprintResult] = await Promise.allSettled([
            withReferenceAnalysisTimeout(detectTransferableElements(analysisImage.base64, analysisImage.mimeType), REFERENCE_ANALYSIS_TIMEOUT_MS, 'Visual DNA analysis'),
            withReferenceAnalysisTimeout(getDominantColor(analysisImage.base64, analysisImage.mimeType), COLOR_ANALYSIS_TIMEOUT_MS, 'Color analysis'),
            withReferenceAnalysisTimeout(analyzeReferenceScene(analysisImage.base64, analysisImage.mimeType), REFERENCE_ANALYSIS_TIMEOUT_MS, 'Scene blueprint analysis')
          ]);
          
          if (isCancelled) return;
          
          const items = itemsResult.status === 'fulfilled' && itemsResult.value.length > 0
            ? itemsResult.value
            : createFallbackReferenceChecklist();
          const color = colorResult.status === 'fulfilled' ? colorResult.value : null;
          const blueprint = blueprintResult.status === 'fulfilled' && blueprintResult.value.trim()
            ? blueprintResult.value
            : createFallbackReferenceBlueprint();

          const itemsWithIntensity = items.map(category => ({
            ...category,
            intensity: 50
          }));
          setChecklist(itemsWithIntensity);
          setAccentColor(color);
          setSceneBlueprint(blueprint);
          setSessionSeed(Math.floor(Math.random() * 1000000));
          lastAnalyzedRefBase64.current = referenceKey; // Track successful analysis
          if (itemsWithIntensity.length > 0) {
            setOpenCategoryId(itemsWithIntensity[0].id);
          }
          const failures = [itemsResult, colorResult, blueprintResult]
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
          if (failures.length > 0) {
            console.warn('Reference image analysis completed with fallback data:', failures);
            setError('Visual DNA analysis took too long, so ISTUDIO loaded reliable starter DNA controls. You can generate now or re-upload the reference to retry the full analysis.');
          }
        } catch (e) {
          if (isCancelled) return;
          console.error("Reference image analysis failed:", e);
          const fallbackItems = createFallbackReferenceChecklist();
          setChecklist(fallbackItems);
          setSceneBlueprint(createFallbackReferenceBlueprint());
          setOpenCategoryId(fallbackItems[0]?.id || null);
          lastAnalyzedRefBase64.current = referenceKey;
          setError(e instanceof Error ? e.message : "Failed to process reference image. ISTUDIO loaded starter DNA controls instead.");
          setAccentColor(null);
          setSessionSeed(null);
        } finally {
          if (!isCancelled) {
            setIsAnalyzing(false);
          }
        }
      } else {
        setChecklist([]);
        setSceneBlueprint(null);
        setAccentColor(null);
        setSessionSeed(null);
        setOpenCategoryId(null);
        setIsAnalyzing(false);
      }
    };
    processReferenceImage();

    return () => {
      isCancelled = true;
    };
  }, [referenceImage.assetPath, referenceImage.assetUrl, referenceImage.base64, referenceImage.mimeType]);

  const handleCheckChange = useCallback((categoryId: string, subItemId: string, checked: boolean) => {
    setChecklist(prev => prev.map(c => c.id === categoryId ? { ...c, items: c.items.map(i => i.id === subItemId ? { ...i, checked } : i) } : c));
  }, []);

  const handleIntensityChange = useCallback((categoryId: string, intensity: number) => {
    setChecklist(prev => prev.map(c => c.id === categoryId ? { ...c, intensity } : c));
  }, []);

  const handleCategoryToggle = useCallback((categoryId: string) => {
    setOpenCategoryId(prev => (prev === categoryId ? null : categoryId));
  }, []);
  
  const handleCustomTextChange = useCallback((categoryId: string, value: string) => {
    setChecklist(prev => prev.map(c => c.id === categoryId ? { ...c, customText: value } : c));
  }, []);

  const handleCustomTextStyleChange = useCallback((categoryId: string, value: string) => {
    setChecklist(prev => prev.map(c => c.id === categoryId ? { ...c, customTextStyle: value } : c));
  }, []);

  const handleCustomPromptChange = useCallback((categoryId: string, value: string) => {
    setChecklist(prev => prev.map(c => c.id === categoryId ? { ...c, customPrompt: value } : c));
  }, []);

  const handleToggleAllInCategory = useCallback((categoryId: string, checkAll: boolean) => {
    setChecklist(prev => 
        prev.map(category => {
            if (category.id === categoryId) {
                return {
                    ...category,
                    items: category.items.map(item => ({ ...item, checked: checkAll }))
                };
            }
            return category;
        })
    );
  }, []);

  const handleSubItemValueChange = useCallback((categoryId: string, subItemId: string, value: string) => {
    setChecklist(prev => prev.map(c => c.id === categoryId ? {
        ...c,
        items: c.items.map(i => i.id === subItemId ? { ...i, customValue: value } : i)
    } : c));
  }, []);

  const prepareCustomAsset = useCallback(async (
    imageState: ImageState,
    analyzer: (base64: string, mimeType: string) => Promise<string>,
  ): Promise<{ storedImage: ImageState; analysis: string }> => {
    const analysisInput = await imageToGeminiInput(imageState, 'single');
    if (!analysisInput.base64 || !analysisInput.mimeType) {
      throw new Error('Could not prepare the custom asset for analysis.');
    }
    const [storedImage, analysis] = await Promise.all([
      persistProjectImage(imageState, 'assets'),
      analyzer(analysisInput.base64, analysisInput.mimeType),
    ]);
    return { storedImage, analysis };
  }, [persistProjectImage]);

  const handleCustomClothingUpload = useCallback(async (gender: 'man' | 'woman', id: string, imageState: ImageState) => {
    const analyzingItems = { ...customClothingItems, [gender]: customClothingItems[gender].map(item => item.id === id ? { ...item, image: imageState, status: 'analyzing' as const } : item) };
    setCustomClothingItems(analyzingItems);
    try {
      const { storedImage, analysis } = await prepareCustomAsset(imageState, analyzeClothingImage);
      const nextItems = { ...customClothingItems, [gender]: customClothingItems[gender].map(item => item.id === id ? { ...item, image: storedImage, analysis, enabled: true, status: 'ready' as const } : item) };
      setCustomClothingItems(nextItems);
      saveProjectNow({ customClothingItems: nextItems });
    } catch (e) {
      console.error("Clothing analysis failed:", e);
      setCustomClothingItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, status: 'error' } : item) }));
    }
  }, [customClothingItems, prepareCustomAsset, saveProjectNow]);

  const handleCustomClothingToggle = useCallback((gender: 'man' | 'woman', id: string, enabled: boolean) => {
    setCustomClothingItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, enabled } : item) }));
  }, []);

  const handleRemoveCustomClothing = useCallback((gender: 'man' | 'woman', id: string) => {
    setCustomClothingItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, image: { fileName: null, base64: null, mimeType: null }, analysis: null, enabled: false, status: 'empty' } : item) }));
  }, []);
  
  const handleCustomAccessoryUpload = useCallback(async (gender: 'man' | 'woman', id: string, imageState: ImageState) => {
    const analyzingItems = { ...customAccessoryItems, [gender]: customAccessoryItems[gender].map(item => item.id === id ? { ...item, image: imageState, status: 'analyzing' as const } : item) };
    setCustomAccessoryItems(analyzingItems);
    try {
      const { storedImage, analysis } = await prepareCustomAsset(imageState, analyzeAccessoryImage);
      const nextItems = { ...customAccessoryItems, [gender]: customAccessoryItems[gender].map(item => item.id === id ? { ...item, image: storedImage, analysis, enabled: true, status: 'ready' as const } : item) };
      setCustomAccessoryItems(nextItems);
      saveProjectNow({ customAccessoryItems: nextItems });
    } catch (e) {
      console.error("Accessory analysis failed:", e);
      setCustomAccessoryItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, status: 'error' } : item) }));
    }
  }, [customAccessoryItems, prepareCustomAsset, saveProjectNow]);

  const handleCustomAccessoryToggle = useCallback((gender: 'man' | 'woman', id: string, enabled: boolean) => {
    setCustomAccessoryItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, enabled } : item) }));
  }, []);

  const handleRemoveCustomAccessory = useCallback((gender: 'man' | 'woman', id: string) => {
    setCustomAccessoryItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, image: { fileName: null, base64: null, mimeType: null }, analysis: null, enabled: false, status: 'empty' } : item) }));
  }, []);
  
  const handleCustomFaceUpload = useCallback(async (gender: 'man' | 'woman', imageState: ImageState) => {
    const analyzingItems = { ...customFaceItems, [gender]: { ...customFaceItems[gender], image: imageState, status: 'analyzing' as const } };
    setCustomFaceItems(analyzingItems);
    try {
      const { storedImage, analysis } = await prepareCustomAsset(imageState, analyzeFaceImage);
      const nextItems = { ...customFaceItems, [gender]: { ...customFaceItems[gender], image: storedImage, analysis, enabled: true, status: 'ready' as const } };
      setCustomFaceItems(nextItems);
      saveProjectNow({ customFaceItems: nextItems });
    } catch (e) {
      console.error("Face analysis failed:", e);
      setCustomFaceItems(prev => ({ ...prev, [gender]: { ...prev[gender], status: 'error' } }));
    }
  }, [customFaceItems, prepareCustomAsset, saveProjectNow]);

  const handleCustomFaceToggle = useCallback((gender: 'man' | 'woman', enabled: boolean) => {
    setCustomFaceItems(prev => ({ ...prev, [gender]: { ...prev[gender], enabled } }));
  }, []);

  const handleRemoveCustomFace = useCallback((gender: 'man' | 'woman') => {
    setCustomFaceItems(prev => ({ ...prev, [gender]: createInitialFaceItem() }));
  }, []);
  
  const handleCustomBackgroundUpload = useCallback(async (imageState: ImageState) => {
    const analyzingItem = { ...customBackgroundItem, image: imageState, status: 'analyzing' as const };
    setCustomBackgroundItem(analyzingItem);
    try {
      const { storedImage, analysis } = await prepareCustomAsset(imageState, analyzeBackgroundImage);
      const nextItem = { ...customBackgroundItem, image: storedImage, analysis, enabled: true, status: 'ready' as const };
      setCustomBackgroundItem(nextItem);
      saveProjectNow({ customBackgroundItem: nextItem });
    } catch (e) {
      console.error("Background analysis failed:", e);
      setCustomBackgroundItem(prev => ({ ...prev, status: 'error' }));
    }
  }, [customBackgroundItem, prepareCustomAsset, saveProjectNow]);

  const handleCustomBackgroundToggle = useCallback((enabled: boolean) => {
    setCustomBackgroundItem(prev => ({ ...prev, enabled }));
  }, []);

  const handleRemoveCustomBackground = useCallback(() => {
    setCustomBackgroundItem(createInitialBackgroundItem());
  }, []);

  const handleCustomSkyUpload = useCallback(async (imageState: ImageState) => {
    const analyzingItem = { ...customSkyItem, image: imageState, status: 'analyzing' as const };
    setCustomSkyItem(analyzingItem);
    try {
      const { storedImage, analysis } = await prepareCustomAsset(imageState, analyzeSkyImage);
      const nextItem = { ...customSkyItem, image: storedImage, analysis, enabled: true, status: 'ready' as const };
      setCustomSkyItem(nextItem);
      saveProjectNow({ customSkyItem: nextItem });
    } catch (e) {
      console.error("Sky analysis failed:", e);
      setCustomSkyItem(prev => ({ ...prev, status: 'error' }));
    }
  }, [customSkyItem, prepareCustomAsset, saveProjectNow]);

  const handleCustomSkyToggle = useCallback((enabled: boolean) => {
    setCustomSkyItem(prev => ({ ...prev, enabled }));
  }, []);

  const handleRemoveCustomSky = useCallback(() => {
    setCustomSkyItem(createInitialSkyItem());
  }, []);

  const getGenerationSettingsSnapshot = useCallback((): HistoryItem['settings'] => {
    const customAssets: string[] = [];

    (['woman', 'man'] as const).forEach((gender) => {
      customClothingItems[gender]
        .filter((item) => item.enabled && item.status === 'ready' && hasImageSource(item.image))
        .forEach((item, index) => customAssets.push(`${gender} clothing ${index + 1}: ${item.image.fileName || 'custom image'}`));
      customAccessoryItems[gender]
        .filter((item) => item.enabled && item.status === 'ready' && hasImageSource(item.image))
        .forEach((item, index) => customAssets.push(`${gender} accessory ${index + 1}: ${item.image.fileName || 'custom image'}`));
      const faceItem = customFaceItems[gender];
      if (faceItem.enabled && faceItem.status === 'ready' && hasImageSource(faceItem.image)) {
        customAssets.push(`${gender} face: ${faceItem.image.fileName || 'custom image'}`);
      }
    });

    if (customBackgroundItem.enabled && customBackgroundItem.status === 'ready' && hasImageSource(customBackgroundItem.image)) {
      customAssets.push(`background: ${customBackgroundItem.image.fileName || 'custom image'}`);
    }
    if (customSkyItem.enabled && customSkyItem.status === 'ready' && hasImageSource(customSkyItem.image)) {
      customAssets.push(`sky: ${customSkyItem.image.fileName || 'custom image'}`);
    }

    return {
      aspectRatio: aspectRatio || null,
      anchorImageId,
      selectedCategories: checklist
        .filter((category) => category.intensity > 0 && (category.items.some((item) => item.checked) || Boolean(category.customPrompt)))
        .map((category) => ({
          id: category.id,
          label: category.label,
          intensity: category.intensity,
          items: [
            ...category.items.filter((item) => item.checked).map((item) => item.label),
            ...(category.customPrompt ? ['Custom background instruction'] : []),
          ],
        })),
      customAssets,
    };
  }, [
    anchorImageId,
    aspectRatio,
    checklist,
    customAccessoryItems,
    customBackgroundItem,
    customClothingItems,
    customFaceItems,
    customSkyItem,
  ]);

  const handleSelectGeneration = useCallback((item: HistoryItem) => {
    setTargetImages(prev => {
      const existingIndex = prev.findIndex(img => img.id === item.targetId);
      if (existingIndex >= 0) {
        const updated = prev.map((img, index) => index === existingIndex ? {
          ...img,
          generated: item.generated,
          status: 'done' as const,
          target: item.target || img.target,
        } : img);
        setActiveImageIndex(existingIndex);
        return updated;
      }

      const restoredTarget: BatchImage = {
        id: item.targetId || `history-${item.id}`,
        target: item.target,
        generated: item.generated,
        status: 'done',
        dominantColor: null,
      };
      setActiveImageIndex(prev.length);
      return [...prev, restoredTarget];
    });
    setIsMobileSidebarOpen(false);
  }, []);

  const handleExportGeneration = useCallback((item: HistoryItem) => {
    const link = document.createElement('a');
    link.href = item.generated;
    const extension = item.generated.startsWith('data:image/jpeg') ? 'jpg' : 'png';
    const baseName = (item.targetFileName || item.target?.fileName || 'istudio-generation').replace(/\.[^/.]+$/, '');
    link.download = `${baseName}-generation-${item.id}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const runGeneration = useCallback(async (imageIndex: number) => {
    const imageToProcess = targetImages[imageIndex];
    if (!imageToProcess || !hasImageSource(imageToProcess.target) || !hasImageSource(referenceImage) || !referenceImage.mimeType) {
        return; 
    }
    
    cancelGenerationRef.current = false;
    setTargetImages(prev => prev.map((img, idx) => idx === imageIndex ? { ...img, status: 'processing' } : img));

    try {
        const queuedOrBatchCount = targetImages.filter(img => img.status === 'queued' || img.status === 'processing').length;
        const qualityMode = queuedOrBatchCount > 1 ? 'batch' : 'single';
        const targetInput = await imageToGeminiInput(imageToProcess.target, qualityMode);
        if (!targetInput.base64 || !targetInput.mimeType) {
          throw new Error('Could not load the project images for generation.');
        }
        const referenceInput = await imageToGeminiInput(referenceImage, qualityMode);
        if (!referenceInput.base64 || !referenceInput.mimeType) {
          throw new Error('Could not load the reference image for generation.');
        }

        setGenerationStatus('analyzing_target');
        const targetImageAnalysis = await analyzeTargetImageDetails(targetInput.base64, targetInput.mimeType);
        if (cancelGenerationRef.current) throw new Error("Cancelled");
        
        setGenerationStatus('generating');
        
        const STYLE_CATEGORIES = ['color_palette', 'lighting', 'mood_atmosphere', 'spatial_dna', 'background_elements', 'subject_style', 'texture_patterns', 'post_processing', 'camera_lens_effects', 'foreground_elements', 'medium_emulation'];
        const CONTENT_CATEGORIES = ['hair_style', 'clothing_style', 'accessories', 'subject_additions'];
        
        const getIntensityInstruction = (intensity: number) => {
            if (intensity <= 25) return "SUBTLE: Apply a very light touch. The target image's original characteristics should remain highly dominant.";
            if (intensity <= 50) return "MODERATE: Blend the style evenly. Noticeable stylistic influence while retaining the target's core feel.";
            if (intensity <= 75) return "STRONG: The reference style should be highly prominent and override much of the target's original aesthetic.";
            return "MAXIMUM: Completely saturate the image with this style. The reference style dictates the entire look and feel for this element.";
        };

        const styleCommands = checklist
            .filter(c => STYLE_CATEGORIES.includes(c.id) && (c.items.some(i => i.checked) || (c.id === 'background_elements' && c.customPrompt)) && c.intensity > 0)
            .map(c => {
                const itemDescriptions = c.items
                    .filter(i => i.checked)
                    .map(i => `- **${i.label}:** ${i.description}`)
                    .join('\n');
                
                let details = itemDescriptions;
                if (c.id === 'background_elements' && c.customPrompt) {
                    details += `\n- **CUSTOM USER INSTRUCTION:** ${c.customPrompt}`;
                }
                
                if (!details) return null;

                const intensityDesc = getIntensityInstruction(c.intensity);

                return `---
**COMMAND: APPLY ${c.label.toUpperCase()}**
**Intensity: ${c.intensity}%** (${intensityDesc})
**Details:**
${details}
---`;
            })
            .filter(Boolean)
            .join('\n');

        const getUncheckedLabels = (categoryId: string): string => {
            const category = checklist.find(c => c.id === categoryId);
            if (!category) return 'All.';
            const labels = category.items.filter(i => !i.checked).map(i => `"${i.label}"`);
            return labels.length > 0 ? labels.join(', ') : 'None.';
        };
        
        const allCategories = [...STYLE_CATEGORIES, ...CONTENT_CATEGORIES];
        const contentOmissionList = allCategories.map(catId => {
            const category = checklist.find(c => c.id === catId);
            if (!category) return null;
            
            // If intensity is 0 or no items are checked, ignore the ENTIRE category
            if (category.intensity === 0 || (!category.items.some(i => i.checked) && !category.customPrompt)) {
                return `- **IGNORE ENTIRE CATEGORY: ${category.label}**. Do NOT transfer any elements related to this from the Reference Image. Preserve the Target Image's original ${category.label.toLowerCase()}.`;
            }

            // Otherwise, ignore specific unchecked items
            const itemsToIgnore = getUncheckedLabels(catId);
            if (itemsToIgnore !== 'None.') {
                return `- **Specific ${category.label} styles to IGNORE:** ${itemsToIgnore}`;
            }
            return null;
        }).filter(Boolean).join('\n');

        const specialInstructionParts: string[] = [];
        
        const getActiveContentCategory = (categoryId: string): StyleCategory | undefined => {
            const category = checklist.find(c => c.id === categoryId);
            if (category && CONTENT_CATEGORIES.includes(categoryId) && category.items.some(i => i.checked) && category.intensity > 0) {
                return category;
            }
            return undefined;
        };
        
        CONTENT_CATEGORIES.forEach(catId => {
            const activeCategory = getActiveContentCategory(catId);
            if(activeCategory) {
                 const items = activeCategory.items.filter(i => i.checked).map(i => i.label).join(', ');
                 const intensityDesc = getIntensityInstruction(activeCategory.intensity);
                 let instruction = `- **CONTENT MODIFICATION: APPLY ${activeCategory.label.toUpperCase()}:** You are authorized to modify this content. Apply the following styles at ${activeCategory.intensity}% intensity (${intensityDesc}): ${items}.`;
                 specialInstructionParts.push(instruction);
            }
        });

        const backgroundCategory = checklist.find(c => c.id === 'background_elements');
        if (backgroundCategory && backgroundCategory.items.some(i => i.checked) && backgroundCategory.intensity > 0) {
            const items = backgroundCategory.items.filter(i => i.checked).map(i => i.label).join(', ');
            specialInstructionParts.push(`- **BACKGROUND REPLACEMENT:** The 'Background' category is active. This is a direct command to **completely replace the original background** of the Target Image with a new scene based on these elements: ${items}. The original background content must be removed. Ensure the subject is perfectly integrated into the new scene with realistic lighting and shadows.`);
        }

        // --- NEW TEXT RENDERING LOGIC ---
        const textCategory = checklist.find(c => c.id === 'text_styles');
        if (textCategory && textCategory.items.some(i => i.checked)) {
            const textInstructions = textCategory.items
                .filter(i => i.checked)
                .map(i => {
                    const content = i.customValue ? `"${i.customValue}"` : "placeholder text matching the style";
                    const isCustom = !!i.customValue;
                    return `
                    - **RENDER TEXT COMMAND:**
                      - **Content:** ${content}
                      - **Style Description:** ${i.description}
                      - **Instruction:** Render legibly on the image. ${isCustom ? 'You MUST use the exact custom content provided.' : 'Infer appropriate placeholder text based on the visual style.'}
                    `;
                }).join('\n');
            
            specialInstructionParts.push(`---
**CRITICAL INSTRUCTION: TEXT RENDERING**
You must render text onto the image based on the following specifications.
${textInstructions}
---`);
        } else {
             specialInstructionParts.push(`- **NO TYPOGRAPHY MANDATE:** You are strictly FORBIDDEN from adding any text, letters, watermarks, or signatures to the generated image. Do not transfer typography from the Reference Style. Preserve existing text in the Target Image only.`);
        }
        
        const processCustomItemsForPrompt = (
            gender: 'man' | 'woman', 
            items: (CustomClothingItem | CustomAccessoryItem | CustomFaceItem)[],
            type: 'CLOTHING' | 'ACCESSORY' | 'FACE'
        ) => {
            const activeItems = items.filter(item => item && item.enabled && item.status === 'ready' && hasImageSource(item.image));
            if (activeItems.length === 0) return null;
          
            const itemDescriptions = activeItems.map((item, index) => `- ${type === 'FACE' ? 'Face' : type.charAt(0) + type.slice(1).toLowerCase()} Item ${index + 1}: ${item!.analysis}`).join('\n');
            
            const typeLower = type.toLowerCase();
            const action = type === 'FACE' 
              ? `You MUST refine the face of the ${gender} in the Target Image...`
              : `You MUST replace the existing ${typeLower} worn by the ${gender} in the Target Image.`;
            
            const source = `Use the provided additional "${gender.charAt(0).toUpperCase() + gender.slice(1)} ${type.charAt(0) + type.slice(1).toLowerCase()} Item" image(s) as the visual source.`;
            const descriptionLabel = type === 'FACE' ? `Description of ${gender} Reference Face:` : `Description of New ${typeLower}:`;
            
            const integrationRules = type === 'FACE'
              ? `This is NOT a face swap. You must perform a seamless and photorealistic blend. Preserve the Target Image's head pose, angle, expression, and overall lighting MUST be preserved perfectly. Intelligently merge the key features (eyes, nose, mouth shape, jawline) from the reference onto the target. The result must look like the same person from the reference photo, but in the context of the target photo. Ensure skin tones match and the lighting on the refined face is consistent with the rest of the scene.`
              : `The new ${typeLower} must be seamlessly and realistically integrated onto the subject, matching their pose, body shape, and the scene's lighting. The fabric should drape naturally. This must look like a real photograph, not a cut-and-paste job.`;
          
            return `---
**CRITICAL OVERRIDE: ${type} REPLACEMENT for ${gender.toUpperCase()}**
This is a non-negotiable directive that **OVERRIDES** the Prime Directive for the ${gender}'s ${typeLower}.
- **Action:** ${action}
- **Source:** ${source}
- **${descriptionLabel}**
${itemDescriptions}
- **Integration:** ${integrationRules}
- **Priority:** This ${typeLower} replacement takes precedence over any other ${typeLower}-related style transfer commands for the ${gender}.
---`;
        };
        
        (['woman', 'man'] as const).forEach(gender => {
            const clothingPrompt = processCustomItemsForPrompt(gender, customClothingItems[gender], 'CLOTHING');
            if (clothingPrompt) specialInstructionParts.push(clothingPrompt);

            const accessoryPrompt = processCustomItemsForPrompt(gender, customAccessoryItems[gender], 'ACCESSORY');
            if (accessoryPrompt) specialInstructionParts.push(accessoryPrompt);

            const faceItem = customFaceItems[gender];
            const facePrompt = processCustomItemsForPrompt(gender, hasImageSource(faceItem.image) ? [faceItem] : [], 'FACE');
            if (facePrompt) specialInstructionParts.push(facePrompt);
        });

        if (customBackgroundItem.enabled && customBackgroundItem.status === 'ready' && hasImageSource(customBackgroundItem.image)) {
            const backgroundDescription = customBackgroundItem.analysis;
            specialInstructionParts.push(`---
**CRITICAL OVERRIDE: BACKGROUND REPLACEMENT & UNIFIED SCENE MANDATE**
This is your highest-priority, non-negotiable directive. It **OVERRIDES** all other instructions regarding the background and imposes a strict standard of photorealism.
- **Core Philosophy: The Subject Was *Always* There.** Your goal is not to "paste" the subject onto the background. You must create the illusion that the subject was physically present in the new environment when the photograph was taken. Every pixel must support this illusion. The final image must be physically and emotionally cohesive.
- **Action:** You MUST completely replace the background of the Target Image. The new background is provided in the "Custom Background" image.
- **Source:** Use the provided "Custom Background" image as the visual source.
- **Lighting & Integration Blueprint:** ${backgroundDescription}
- **INTEGRATION PROTOCOL (VFX-GRADE COMPOSITING):** The subject from the Target Image must be flawlessly composited into this new background. The final image must be indistinguishable from a single, unified photograph shot on location.
    1.  **Isolate:** Perform a perfect, hair-level-detail isolation of the subject. The edge quality must be perfect.
    2.  **Place & Scale:** Ensure the subject is scaled and placed at a realistic perspective within the new scene.
    3.  **Virtual Re-Lighting Protocol (CRITICAL):** This is not a 2D filter. You must simulate a virtual 3D lighting environment based on the provided blueprint.
        - **Blueprint Adherence:** You MUST adhere strictly to the lighting and scene analysis, including the "Lighting Essence".
        - **Re-light Subject:** Apply the new lighting to the isolated subject. The new light MUST realistically wrap around the subject's form, creating physically accurate highlights and shadows.
        - **Shadow Casting:** The subject MUST cast new, realistic shadows onto the new background. The shadow's direction, softness (penumbra), and color MUST perfectly match the lighting blueprint. This includes contact occlusion.
        - **Color Harmony & Bleed:** Harmonize the subject's colors with the new scene. You MUST simulate "color bleed" - the subtle reflection of environmental colors (e.g., blue from the sky, green from grass) onto the edges and surfaces of the subject. This is a key to seamless integration.
    4.  **Edge Integration & Atmospheric Blending (CRITICAL):** To avoid a "cut-out" look, you MUST:
        - **Light Wrap:** Simulate the new background's light subtly wrapping around the subject's edges.
        - **Atmospheric Haze:** If the blueprint mentions haze or depth, you must apply a matching, subtle haze to the subject to place them correctly in the scene's depth.
        - **Focus & Sharpness Matching:** The subject's sharpness and focus plane must perfectly match the background's depth of field. Do not place a sharp subject in a blurry background without a realistic transition.
    5.  **Black/White Point Matching:** The blackest blacks and whitest whites of the subject must be re-mapped to match the black and white points of the new background scene. Mismatched levels are an instant failure.
- **Priority:** This background replacement takes precedence over ALL other background-related style transfer commands. Any selected items in the "Background Elements" category must be ignored.
---`);
        }

        if (customSkyItem.enabled && customSkyItem.status === 'ready' && hasImageSource(customSkyItem.image)) {
            const skyDescription = customSkyItem.analysis;
            specialInstructionParts.push(`---
**CRITICAL OVERRIDE: SKY REPLACEMENT**
This is a specific directive to replace the SKY in the Target Image with the custom sky provided.
- **Action:** Replace the sky area of the Target Image with the content of the "Custom Sky" image.
- **Source:** Use the provided "Custom Sky" image as the visual source for the new sky.
- **Sky Analysis & Blueprint:** ${skyDescription}
- **INTEGRATION INSTRUCTIONS:**
    1. **Segmentation:** Precisely mask the sky, handling complex occlusions like trees, buildings, and hair.
    2. **Horizon Blending:** Ensure a seamless, realistic transition at the horizon line. Avoid harsh cuts.
    3. **Global Illumination Update:** The new sky determines the ambient lighting. You MUST adjust the lighting on the foreground and subject to match the color temperature, intensity, and direction of the new sky (e.g., if the new sky is a sunset, the subject must be bathed in warm, golden light).
    4. **Reflections:** If there are reflective surfaces (water, glass) in the foreground, the new sky must be reflected in them.
- **GEOMETRIC PRESERVATION (CRITICAL):**
    - You must NOT move, resize, or alter the pose of the subject or any foreground elements.
    - The sky replacement is a background operation. The foreground geometry is SACROSANCT.
- **Priority:** This overrides general background style settings but works within the context of the overall scene. If a Full Background Replacement is also active, this Sky Replacement is ignored (Full Background takes precedence).
---`);
        }

        const specialInstructionsSection = specialInstructionParts.length > 0 
            ? specialInstructionParts.join('\n') 
            : 'No special overrides authorized. Adhere strictly to the Prime Directive for all content.';

        const anchorScene = anchorImageId ? targetImages.find(img => img.id === anchorImageId) : null;
        const isStatefulIteration = !!(anchorScene && anchorScene.generated);
        const targetWorkingResolution = imageToProcess.target.width && imageToProcess.target.height
          ? `${imageToProcess.target.width}x${imageToProcess.target.height}`
          : 'the supplied target image resolution';

        const anchorSceneInstruction = isStatefulIteration ? `
---
**STATEFUL ITERATION MODE (CRITICAL)**
You have been provided with an additional image: the **ANCHOR SCENE** (Image 2).
This is a "Persistent Scene Diffusion Engine". 
- **BACKGROUND SOURCE:** You MUST extract the EXACT background, lighting, depth, and layout from the Anchor Scene.
- **SUBJECT SOURCE (CRITICAL):** You MUST extract the subject from the Target Image (Image 1). 
- **SUBJECT REPLACEMENT:** You are STRICTLY FORBIDDEN from copying the subject, pose, or identity from the Anchor Scene. The subject in the Anchor Scene is a placeholder. You must completely replace them with the subject from Image 1.
- **COMPOSITING:** Composite the subject from Image 1 seamlessly into the EXACT background of Image 2. The subject MUST look like they were physically present in that exact room/environment when the photo was taken. Pay extreme attention to matching the lighting, shadows, and scale of Image 2.
Apply the style from the Reference Image with a decay factor (alpha) to prevent over-stylization, focusing primarily on blending the subject realistically into the established scene.
---
` : '';

        const prompt = `
**IMAGE INPUTS:**
- IMAGE 1: The Target Image (Subject to be styled and composited).
${isStatefulIteration
  ? '- IMAGE 2: The Anchor Scene (The exact background and lighting environment to reuse).\n- IMAGE 3: The Reference DNA image. Use it as the direct visual source for background, lighting, color, mood, texture, spatial DNA, and final finish.'
  : '- IMAGE 2: The Reference DNA image. Use it as the direct visual source for background, lighting, color, mood, texture, spatial DNA, and final finish.'}
- SUBSEQUENT IMAGES (if any): Custom elements (clothing, accessories, faces, backgrounds) to apply.

**PRIME DIRECTIVE: ABSOLUTE GEOMETRIC LOCK & SUBJECT INTEGRITY (NON-NEGOTIABLE)**
1. **GEOMETRIC LOCK:** You must treat the Target Image (Image 1) as a rigid, immutable structural wireframe. You are strictly forbidden from modifying the subject's pose, position, scale, or framing. This includes the exact position of arms, head, fingers, and body posture.
2. **SUBJECT INTEGRITY:** The subject's anatomy and physical state must remain 100% identical to Image 1. You are only transforming the aesthetic, lighting, and environment.
3. **STYLE PRECISION:** You MUST strictly adhere to the provided Intensity percentages for each style category. 
   - 0-25%: Barely perceptible influence.
   - 26-50%: Balanced blend.
   - 51-75%: Strong stylistic dominance.
   - 76-100%: Total stylistic takeover.
4. **CAMERA-GRADE DETAIL PRESERVATION:** Treat Image 1 as a high-resolution Canon R5 C still. Preserve micro-detail: hair strands, eyelashes, eyes, teeth, fingernails, jewelry, skin texture, fabric weave, stitching, labels, and natural camera sharpness. Do not create waxy skin, smudged fabric, low-detail hands, blurred accessories, or AI-smooth plastic texture.
5. **RESOLUTION & FRAME FIDELITY:** The target working resolution is ${targetWorkingResolution}. Preserve the exact crop, framing, aspect ratio, and subject scale. Return the highest supported 4K-quality image with crisp fine details and no artificial softening.

**ROLE & GOAL**
You are an Elite Photorealistic Compositing and Style Transfer Engine. Your absolute top priority is UNCOMPROMISING REALISM while PRESERVING THE PHOTOGRAPHER'S ORIGINAL POSE. Every generation must look like a genuine, unedited photograph. The subject must be seamlessly integrated into the environment without moving a single limb or changing their head tilt.

${anchorSceneInstruction}

1.  **SUBJECT-LIT OUTPAINTING & ULTIMATE REALISM (TOP PRIORITY):**
    - **SUBJECT LIGHTING IS THE SOURCE OF TRUTH:** The target subject already contains the correct key light, fill, shadow side, rim light, skin/clothing color temperature, and catchlights. Infer the environment that would naturally create this lighting, then generate that environment around the subject.
    - **REFERENCE DNA SCENE BUILD:** Replace or restyle the environment using the Reference DNA, custom background, custom sky, and selected controls while keeping the target subject's identity, anatomy, pose, and framing stable.
    - **NO CUT-OUT LOOK:** The generated image must blend the subject and environment in-camera with realistic light wrap, edge atmosphere, color bleed, shadows, and occlusion.
    - **GROUNDING & PLACEMENT:** The subject must be perfectly grounded in the scene. No floating subjects. You MUST generate appropriate contact shadows that match the scene's lighting direction and quality.
    - **SCALE & PERSPECTIVE:** Preserve the subject's original scale, position, and framing from Image 1. Match the generated environment to the subject's camera angle and focal length; never scale the subject to fit the environment.
    - **LIGHTING MATCH:** The environmental lighting MUST perfectly match the lighting already visible on the subject. Replicate the subject's light direction, quality (soft/hard), color temperature, shadow side, and ambient bounce light in the generated scene.
    - **REFLECTIONS & SPECULARITY:** Generate realistic reflections of the environment on all appropriate surfaces: eyes, skin (subtle specularity), water, glass, metallic objects, and polished floors. Reflections must be geometrically accurate based on the scene's layout.
    - **ENVIRONMENTAL "STUFF" & ATMOSPHERE:** Include subtle environmental details that enhance photorealism: micro-dust particles in light beams, realistic atmospheric haze, subtle lens flares (if looking towards light), and realistic texture interactions (e.g., wetness, dirt, or fabric grain).
    - **SEAMLESS BLENDING:** Edges must blend naturally without halos or cut-out artifacts. Match the depth of field and film grain/noise of the environment perfectly.

2.  **ABSOLUTE BATCH CONSISTENCY (CRITICAL PRIORITY):**
    - **SCENE LOCK:** This generation is part of a batch. You MUST maintain absolute consistency with the Reference Visual DNA. The lighting, blending, and scene environment MUST look identical to any other image generated with this reference.
    - **ENVIRONMENTAL STABILITY:** Do not hallucinate different backgrounds or lighting conditions. The environment must be a 1:1 match with the reference blueprint.

3.  **ATMOSPHERIC & SPATIAL DNA TRANSFER:**
    - **DNA REPLICATION:** You must accurately replicate the "Visual DNA" of the Reference Image. This includes the specific quality of light, the atmospheric haze, the texture of surfaces, and the overall "soul" of the reference.
    - **SPATIAL MAPPING:** Objects and stylistic elements from the Reference Image should be mapped to the same relative positions in the output. If the reference has a specific lighting direction or background object placement, you must replicate that spatial layout in the output (while respecting the Target Subject's position).

4.  **SPATIAL & POSE INTEGRITY (HIGHEST PRIORITY):**
    - **FROZEN SKELETON:** The subject's pose MUST be identical to Image 1. You are FORBIDDEN from making even "subtle" adjustments to the pose. The head tilt, arm positions, and finger placements must be pixel-perfect matches to the original.
    - **PIXEL-PERFECT POSITION:** The subject's position, size, silhouette, and framing must remain consistent with Image 1. Adjust the new floor/background/shadows to ground the subject, not the subject itself.
    - **NO RESIZING/RATIO CHANGE:** You are FORBIDDEN from changing the overall image aspect ratio.
    ${!aspectRatio ? '- **NO FRAME EXPANSION**: Do NOT generate outside the original image boundaries. Regenerate the in-frame environment around the target subject without expanding the frame.' : ''}

5.  **IDENTITY LOCK (SUPREME AUTHORITY):**
    - The face, hair, and clothing in the output MUST be the EXACT same as in the Target Image (Image 1). Preserve all unique biometric features, moles, scars, and textures.${isStatefulIteration ? ' DO NOT use the subject from the Anchor Scene (Image 2).' : ''}

**EXECUTION WORKFLOW**

**STEP 1: ANALYZE THE TARGET IMAGE DNA**
${targetImageAnalysis}

**STEP 1.5: REFERENCE VISUAL DNA & SPATIAL BLUEPRINT (SOURCE OF TRUTH)**
${sceneBlueprint || "No scene blueprint available."}

**STEP 2: EXECUTE STYLE TRANSFER COMMANDS**
${styleCommands.length > 0 ? styleCommands : "No style commands. The image should remain unchanged aesthetically."}

**STEP 3: OBSERVE THE CONTENT OMISSION LIST**
${contentOmissionList}

**STEP 4: EXECUTE CONTENT MODIFICATION DIRECTIVES**
${specialInstructionsSection}

**STEP 5: FINAL VERIFICATION**
Before outputting, verify:
1. Did the pose, head angle, arm position, or body posture change from Image 1? If yes, FAIL.
2. Did the subject's anatomy or identity change from Image 1? If yes, FAIL.
3. Did the teeth or eyes change from Image 1? If yes, FAIL.
4. Does the atmosphere and lighting perfectly match the Reference DNA? If no, FAIL.
5. Is the scene environment completely consistent with the Reference Blueprint? If no, FAIL.
6. Are fine details sharp and camera-quality at the highest supported output size? If no, FAIL.
`;
        if (cancelGenerationRef.current) throw new Error("Cancelled");
        
        const activeItems = [
            ...customClothingItems.woman, ...customClothingItems.man,
            ...customAccessoryItems.woman, ...customAccessoryItems.man,
            customFaceItems.woman, customFaceItems.man
        ].filter(item => item.enabled && item.status === 'ready' && hasImageSource(item.image));

        const imageParts = [
            { inlineData: { data: targetInput.base64, mimeType: targetInput.mimeType }}
        ];

        if (isStatefulIteration && anchorScene?.generated) {
            const anchorInline = await sourceToInlineData(anchorScene.generated, 'image/png');
            imageParts.push({
                inlineData: anchorInline
            });
        }

        imageParts.push({
            inlineData: { data: referenceInput.base64, mimeType: referenceInput.mimeType }
        });

        const activeItemInputs = await Promise.all(activeItems.map(item => imageToGeminiInput(item.image, qualityMode)));
        imageParts.push(...activeItemInputs
          .filter(item => item.base64 && item.mimeType)
          .map(item => ({ inlineData: { data: item.base64!, mimeType: item.mimeType! } })));

        if (customBackgroundItem.enabled && customBackgroundItem.status === 'ready' && hasImageSource(customBackgroundItem.image)) {
            const backgroundInput = await imageToGeminiInput(customBackgroundItem.image, qualityMode);
            if (backgroundInput.base64 && backgroundInput.mimeType) {
            imageParts.push({
                inlineData: { data: backgroundInput.base64, mimeType: backgroundInput.mimeType }
            });
            }
        }

        if (customSkyItem.enabled && customSkyItem.status === 'ready' && hasImageSource(customSkyItem.image)) {
            const skyInput = await imageToGeminiInput(customSkyItem.image, qualityMode);
            if (skyInput.base64 && skyInput.mimeType) {
            imageParts.push({
                inlineData: { data: skyInput.base64, mimeType: skyInput.mimeType }
            });
            }
        }

        const seed = (isStatefulIteration && sessionSeed) ? sessionSeed : Math.floor(Math.random() * 1000000);
        const newImageBase64 = await editImage(imageParts, prompt, aspectRatio, seed);
        if (cancelGenerationRef.current) throw new Error("Cancelled");

        const outputFileName = `${(imageToProcess.target.fileName || 'istudio-output').replace(/\.[^/.]+$/, '')}-reference-edit.png`;
        const storedOutput = await persistProjectImage({
          fileName: outputFileName,
          base64: newImageBase64,
          mimeType: 'image/png',
          width: null,
          height: null,
        }, 'outputs');
        const newImageSrc = storedOutput.assetUrl || `data:image/png;base64,${newImageBase64}`;

        const generationId = Date.now();
        const settingsSnapshot = getGenerationSettingsSnapshot();
        const historyItem: HistoryItem = {
          id: generationId,
          projectId: project?.id || 'live-session',
          generated: newImageSrc,
          target: compactHistoryImage(imageToProcess.target, imageToProcess.target.fileName),
          reference: compactHistoryImage(referenceImage, referenceImage.fileName),
          targetId: imageToProcess.id,
          targetFileName: imageToProcess.target.fileName,
          settings: settingsSnapshot,
        };

        // Update state to show image
        setTargetImages(prev => prev.map((img, idx) => idx === imageIndex ? {
          ...img,
          status: 'done',
          generated: newImageSrc,
        } : img));
        setGenerationHistory(prev => [historyItem, ...prev].slice(0, 200));

        setGenerationStatus('saving');
    } catch (e) {
      const isCancelled = e instanceof Error && e.message === "Cancelled";
      if (isCancelled) {
          setError("Generation cancelled by user.");
      } else {
          setError(e instanceof Error ? e.message : "An unknown error occurred.");
      }
      setTargetImages(prev => prev.map((img, idx) => {
          if (idx === imageIndex) {
              return { ...img, status: isCancelled ? 'pending' : 'error' };
          }
          return img;
      }));
    } finally {
      setGenerationStatus('idle');
    }
  }, [
    anchorImageId,
    aspectRatio,
    checklist,
    customAccessoryItems,
    customBackgroundItem,
    customClothingItems,
    customFaceItems,
    customSkyItem,
    getGenerationSettingsSnapshot,
    project?.id,
    referenceImage,
    saveProjectNow,
    sceneBlueprint,
    sessionSeed,
    targetImages,
  ]);

  // Queue processing effect
  useEffect(() => {
    const isProcessing = targetImages.some(img => img.status === 'processing');
    if (isProcessing) {
        return;
    }

    const nextImageInQueueIndex = targetImages.findIndex(img => img.status === 'queued');
    if (nextImageInQueueIndex !== -1) {
        runGeneration(nextImageInQueueIndex);
    }
  }, [targetImages, runGeneration]);
  
  const handleQueueGeneration = useCallback(() => {
    if (activeImageIndex < 0 || !targetImages[activeImageIndex]) {
      setError("Please upload and select a target image.");
      return;
    }
    if (!hasImageSource(referenceImage) || !referenceImage.mimeType) {
      setError("Upload a reference photo to define the visual DNA.");
      return;
    }
    
    setError(null);
    setIsMobileSidebarOpen(false);
    const categoriesWithSelections = checklist.filter(c => c.items.some(i => i.checked) && c.intensity > 0);
    const hasCustomClothing = [...customClothingItems.man, ...customClothingItems.woman].some(c => c.enabled && c.status === 'ready');
    const hasCustomAccessory = [...customAccessoryItems.man, ...customAccessoryItems.woman].some(c => c.enabled && c.status === 'ready');
    const hasCustomFace = [customFaceItems.man, customFaceItems.woman].some(c => c.enabled && c.status === 'ready');
    const hasCustomBackground = customBackgroundItem.enabled && customBackgroundItem.status === 'ready';
    const hasCustomSky = customSkyItem.enabled && customSkyItem.status === 'ready';
    
    if (categoriesWithSelections.length === 0 && !hasCustomClothing && !hasCustomAccessory && !hasCustomFace && !hasCustomBackground && !hasCustomSky) {
        setError("Select at least one DNA element or enable a custom asset.");
        return;
    }

    setTargetImages(prev => prev.map((img, idx) => idx === activeImageIndex ? { ...img, status: 'queued' } : img));
  }, [activeImageIndex, targetImages, referenceImage, checklist, customClothingItems, customAccessoryItems, customFaceItems, customBackgroundItem, customSkyItem]);

  const handleQueueSelected = useCallback(() => {
    if (!hasImageSource(referenceImage) || !referenceImage.mimeType) {
        setError("Upload a reference photo to define the visual DNA.");
        return;
    }
    
    setError(null);
    setIsMobileSidebarOpen(false);
    const categoriesWithSelections = checklist.filter(c => c.items.some(i => i.checked) && c.intensity > 0);
    const hasCustomClothing = [...customClothingItems.man, ...customClothingItems.woman].some(c => c.enabled && c.status === 'ready');
    const hasCustomAccessory = [...customAccessoryItems.man, ...customAccessoryItems.woman].some(c => c.enabled && c.status === 'ready');
    const hasCustomFace = [customFaceItems.man, customFaceItems.woman].some(c => c.enabled && c.status === 'ready');
    const hasCustomBackground = customBackgroundItem.enabled && customBackgroundItem.status === 'ready';
    const hasCustomSky = customSkyItem.enabled && customSkyItem.status === 'ready';
    
    if (categoriesWithSelections.length === 0 && !hasCustomClothing && !hasCustomAccessory && !hasCustomFace && !hasCustomBackground && !hasCustomSky) {
        setError("Select at least one DNA element or enable a custom asset.");
        return;
    }

    setTargetImages(prev => prev.map(img => 
        (selectedImageIds.has(img.id) && (img.status === 'pending' || img.status === 'error')) 
            ? { ...img, status: 'queued' } 
            : img
    ));
    
    // Optional: Clear selection after queuing
    setSelectedImageIds(new Set());
  }, [targetImages, referenceImage, checklist, customClothingItems, customAccessoryItems, customFaceItems, customBackgroundItem, customSkyItem, selectedImageIds]);

  const handleQueueAll = useCallback(() => {
    if (!hasImageSource(referenceImage) || !referenceImage.mimeType) {
        setError("Upload a reference photo to define the visual DNA.");
        return;
    }
    
    setError(null);
    const categoriesWithSelections = checklist.filter(c => c.items.some(i => i.checked) && c.intensity > 0);
    const hasCustomClothing = [...customClothingItems.man, ...customClothingItems.woman].some(c => c.enabled && c.status === 'ready');
    const hasCustomAccessory = [...customAccessoryItems.man, ...customAccessoryItems.woman].some(c => c.enabled && c.status === 'ready');
    const hasCustomFace = [customFaceItems.man, customFaceItems.woman].some(c => c.enabled && c.status === 'ready');
    const hasCustomBackground = customBackgroundItem.enabled && customBackgroundItem.status === 'ready';
    const hasCustomSky = customSkyItem.enabled && customSkyItem.status === 'ready';
    
    if (categoriesWithSelections.length === 0 && !hasCustomClothing && !hasCustomAccessory && !hasCustomFace && !hasCustomBackground && !hasCustomSky) {
        setError("Select at least one DNA element or enable a custom asset.");
        return;
    }

    setTargetImages(prev => prev.map(img => 
        (img.status === 'pending' || img.status === 'error') ? { ...img, status: 'queued' } : img
    ));
  }, [targetImages, referenceImage, checklist, customClothingItems, customAccessoryItems, customFaceItems, customBackgroundItem, customSkyItem]);
  
  const handleRemoveImage = useCallback((idToRemove: string) => {
    setTargetImages(prev => {
        const newImages = prev.filter(img => img.id !== idToRemove);
        if (newImages.length === 0) {
            setActiveImageIndex(-1);
        } else if (activeImageIndex >= newImages.length) {
            setActiveImageIndex(newImages.length - 1);
        }
        return newImages;
    });
    // Remove from selection as well
    setSelectedImageIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(idToRemove);
        return newSet;
    });
  }, [activeImageIndex]);
  
  const handleToggleSelection = useCallback((id: string) => {
      setSelectedImageIds(prev => {
          const newSet = new Set(prev);
          if (newSet.has(id)) {
              newSet.delete(id);
          } else {
              newSet.add(id);
          }
          return newSet;
      });
  }, []);
  
  const handleCancelGeneration = useCallback(() => {
      cancelGenerationRef.current = true;
      setError(null);
  }, []);

  const activeTarget = activeImageIndex > -1 ? targetImages[activeImageIndex] : null;
  const activeTargetIsProcessing = activeTarget?.status === 'processing';
  
  const hasActiveCustomItems = [
    ...customClothingItems.man, ...customClothingItems.woman,
    ...customAccessoryItems.man, ...customAccessoryItems.woman,
    customFaceItems.man, customFaceItems.woman
  ].some(item => item.enabled) || customBackgroundItem.enabled || customSkyItem.enabled;

  const isActionable = !isAnalyzing && !!activeTarget && !['queued', 'processing'].includes(activeTarget.status) && hasImageSource(referenceImage) && (checklist.length > 0 || hasActiveCustomItems);

  const getGenerateButtonText = () => {
    if (activeTarget?.status === 'queued') {
        return 'Queued';
    }
    if (activeTarget?.status === 'done' || activeTarget?.generated) {
      return 'Refine Edit';
    }
    return 'Apply Reference DNA';
  };

  // Only lock controls if the active target is actually processing or analyzing.
  // This allows switching to other images and queuing them up.
  const isControlsLocked = activeTargetIsProcessing || isAnalyzing;
  const selectedCount = selectedImageIds.size;
  const isTetherWatchingThisProject = Boolean(tetherStatus?.isWatching && project?.id && tetherStatus.projectId === project.id);
  const tetherCapturesForProject = (tetherStatus?.captures || [])
    .filter((capture) => !project?.id || capture.projectId === project.id || capture.projectId === tetherStatus?.projectId)
    .slice(0, 8);
  const tetherStatusLabel = isTetherWatchingThisProject
    ? 'Watching'
    : tetherStatus?.isWatching
      ? 'Watching another project'
      : 'Idle';
  const tetherSetupWarning = tetherAutoEdit && !canAutoQueueTether
    ? 'Auto Edit is on. Add a reference image and select at least one DNA control before new captures can generate.'
    : null;
  const getTetherCaptureDisplay = (capture: TetherCapture) => {
    const target = capture.id ? targetImages.find((image) => image.tetherCaptureId === capture.id) : null;
    if (target?.status === 'processing') return { label: 'Processing', tone: 'text-[var(--color-accent)]' };
    if (target?.status === 'queued') return { label: 'Queued', tone: 'text-sky-300' };
    if (target?.status === 'done') return { label: 'Done', tone: 'text-emerald-300' };
    if (target?.status === 'error' || capture.status === 'failed') return { label: 'Failed', tone: 'text-red-300' };
    if (capture.status === 'ignored') return { label: 'Ignored', tone: 'text-amber-300' };
    return { label: 'Imported', tone: 'text-[var(--color-text-muted)]' };
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mobile-reference-workspace relative flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)] lg:flex-row"
      style={{'--dynamic-accent-color': accentColor || 'var(--color-accent)'} as React.CSSProperties}
    >
      {/* Mobile Toggle Button */}
      <button 
        onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        className="mobile-settings-fab fixed right-3 top-[calc(env(safe-area-inset-top)+72px)] z-[100] flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-[var(--color-accent)] text-black shadow-2xl shadow-black/40 transition-transform active:scale-95 lg:hidden"
        aria-label="Open edit settings"
      >
        <div className="relative">
          <AnimatePresence mode="wait">
            {isMobileSidebarOpen ? (
              <motion.div
                key="close"
                initial={{ opacity: 0, rotate: -90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 90 }}
              >
                <XCircleIcon className="w-6 h-6" />
              </motion.div>
            ) : (
              <motion.div
                key="settings"
                initial={{ opacity: 0, rotate: 90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: -90 }}
              >
                <SettingsIcon className="w-5 h-5" />
              </motion.div>
            )}
          </AnimatePresence>
          {checklist.some(c => c.items.some(i => i.checked)) && !isMobileSidebarOpen && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-black" />
          )}
        </div>
      </button>

      {/* --- Main Editor Area (Left) --- */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 relative z-10 w-full overflow-hidden">
        <div className="flex-1 overflow-hidden relative">
            <MainPanel
              activeTarget={activeTarget}
              allTargets={targetImages}
              activeIndex={activeImageIndex}
              onSelectIndex={setActiveImageIndex}
              onImagesSelect={handleTargetImagesSelect}
              onRemoveImage={handleRemoveImage}
              generationStatus={generationStatus}
              referenceImage={referenceImage}
              onReferenceImageSelect={handleReferenceImageSelect}
              referenceDominantColor={accentColor}
              selectedImageIds={selectedImageIds}
              onToggleImageSelection={handleToggleSelection}
            />
        </div>
      </main>

      {/* --- Sidebar (Right) --- */}
      <aside className={`fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] right-[max(0.5rem,env(safe-area-inset-right))] top-[calc(env(safe-area-inset-top)+68px)] z-[90] w-[min(420px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl transition-transform duration-500 ease-in-out lg:relative lg:inset-auto lg:z-30 lg:flex lg:w-full lg:max-w-[360px] lg:translate-x-0 lg:rounded-none lg:border-y-0 lg:border-r-0 xl:max-w-[400px] ${
        isMobileSidebarOpen ? 'flex translate-x-0' : 'hidden translate-x-full'
      }`}>
        {/* Mobile Sidebar Close Backdrop */}
        <AnimatePresence>
          {isMobileSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm lg:hidden"
            />
          )}
        </AnimatePresence>
        <div className="flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-header)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Reference DNA</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Control the inherited background, lighting, style, mood, and selected elements.</p>
        </div>
        
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-6 custom-scrollbar">
          {/* Reference Image Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-muted)]">
                <SparklesIcon className="w-3 h-3 text-[var(--color-accent)]" />
                DNA Reference
              </h2>
              {hasImageSource(referenceImage) && (
                <button 
                  onClick={() => handleReferenceImageSelect({ fileName: null, base64: null, mimeType: null })}
                  className="text-xs font-semibold text-red-400/80 transition-colors hover:text-red-300"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="group relative rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1">
              <ImageUploader
                id="reference-image"
                title="DNA Reference"
                subtitle="Upload source"
                image={referenceImage}
                onImageSelect={handleReferenceImageSelect}
                dominantColor={accentColor}
                disabled={isControlsLocked}
                className="aspect-square overflow-hidden rounded-lg"
              />
              {accentColor && (
                <div 
                  className="absolute bottom-3 right-3 w-4 h-4 rounded-full border border-black shadow-lg"
                  style={{ backgroundColor: accentColor }}
                  title="Dominant Color"
                />
              )}
            </div>
          </section>

          {/* Tethered Mode Section */}
          {!isBrowserStorage && (
          <section>
            <button
              type="button"
              onClick={() => setIsTetherPanelOpen((isOpen) => !isOpen)}
              className="group flex w-full items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-left transition-all hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-hover)]"
              aria-expanded={isTetherPanelOpen}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border ${
                  isTetherWatchingThisProject
                    ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]'
                }`}>
                  <CameraIcon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[var(--color-text)]">Tethered Mode</span>
                  <span className="block truncate text-[11px] text-[var(--color-text-muted)]">
                    {isTetherWatchingThisProject ? 'Camera folder linked to this project' : 'Auto-import photos from a capture folder'}
                  </span>
                </span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-2">
                <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${
                  isTetherWatchingThisProject
                    ? 'border-[var(--color-accent)]/20 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]'
                }`}>
                  {tetherStatusLabel}
                </span>
                <ChevronDownIcon className={`h-4 w-4 text-[var(--color-text-muted)] transition-transform duration-200 ${isTetherPanelOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>

            <AnimatePresence initial={false}>
              {isTetherPanelOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="mt-3 space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4"
                >
                  <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <RadioIcon className={`mt-0.5 h-4 w-4 shrink-0 ${isTetherWatchingThisProject ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`} />
                    <p className="text-xs leading-5 text-[var(--color-text-muted)]">
                      Point your camera tether software to a folder. ISTUDIO watches that folder, imports new photos, and can queue edits automatically.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Capture folder</label>
                    <div className="flex gap-2">
                      <input
                        value={tetherFolderPath}
                        onChange={(event) => setTetherFolderPath(event.target.value)}
                        placeholder="Paste or choose a folder path"
                        className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-muted)]/50 focus:border-[var(--color-accent)]"
                      />
                      <button
                        type="button"
                        onClick={handlePickTetherFolder}
                        disabled={isTetherBusy}
                        className="btn-secondary flex h-9 w-9 items-center justify-center p-0 disabled:opacity-40"
                        aria-label="Choose capture folder"
                      >
                        <FolderOpenIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
                    <button
                      type="button"
                      onClick={() => setTetherProjectMode('current')}
                      disabled={!project}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30 ${
                        tetherProjectMode === 'current'
                          ? 'bg-[var(--color-accent)] text-black'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-white'
                      }`}
                    >
                      Current project
                    </button>
                    <button
                      type="button"
                      onClick={() => setTetherProjectMode('new')}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                        tetherProjectMode === 'new'
                          ? 'bg-[var(--color-accent)] text-black'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-white'
                      }`}
                    >
                      New session
                    </button>
                  </div>

                  <div className={`flex items-center justify-between gap-4 rounded-xl border px-3 py-3 transition-colors ${
                    tetherAutoEdit
                      ? 'border-[var(--color-accent)]/25 bg-[rgba(var(--color-accent-rgb),0.08)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                  }`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-[var(--color-text)]">Auto Edit</p>
                        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none ${
                          tetherAutoEdit
                            ? 'border-[var(--color-accent)]/25 bg-[var(--color-accent)] text-black'
                            : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]'
                        }`}>
                          {tetherAutoEdit ? 'On' : 'Off'}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-muted)]">Imports always save. When enabled, ready captures queue automatically.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTetherAutoEditChange(!tetherAutoEdit)}
                      disabled={isTetherBusy}
                      role="switch"
                      aria-label="Toggle tethered Auto Edit"
                      className={`relative inline-flex h-8 w-[76px] flex-shrink-0 items-center rounded-full border px-1 text-[10px] font-black uppercase transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50 ${
                        tetherAutoEdit
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-black shadow-[0_0_22px_rgba(var(--color-accent-rgb),0.22)]'
                          : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]'
                      }`}
                      aria-pressed={tetherAutoEdit}
                    >
                      <span className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-lg transition-transform duration-200 ease-out ${tetherAutoEdit ? 'translate-x-[44px]' : 'translate-x-0'}`} />
                      <span className={`pointer-events-none w-1/2 text-center transition-opacity ${tetherAutoEdit ? 'opacity-0' : 'opacity-100'}`}>Off</span>
                      <span className={`pointer-events-none ml-auto w-1/2 text-center transition-opacity ${tetherAutoEdit ? 'opacity-100' : 'opacity-0'}`}>On</span>
                    </button>
                  </div>

                  {tetherSetupWarning && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                      <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                      <p className="text-[11px] leading-5 text-amber-100/80">{tetherSetupWarning}</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {isTetherWatchingThisProject ? (
                      <button
                        type="button"
                        onClick={handleStopTether}
                        disabled={isTetherBusy}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300 transition-all hover:bg-red-500 hover:text-white disabled:opacity-40"
                      >
                        <StopIcon className="h-3.5 w-3.5" />
                        Stop tethering
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStartTether}
                        disabled={isTetherBusy}
                        className="primary-cta flex flex-1 items-center justify-center gap-2 px-4 py-3 text-xs disabled:opacity-40"
                      >
                        <PlayIcon className="h-3.5 w-3.5" />
                        Start tethering
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={refreshTetherStatus}
                      disabled={isTetherBusy}
                      className="btn-secondary flex h-10 w-10 items-center justify-center p-0 disabled:opacity-40"
                      aria-label="Refresh tether status"
                    >
                      <RefreshCwIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Capture tray</span>
                      <span className="text-[11px] text-[var(--color-text-muted)]">{tetherCapturesForProject.length}</span>
                    </div>
                    {tetherCapturesForProject.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-4 text-center text-[11px] text-[var(--color-text-muted)]">
                        New captures will appear here.
                      </div>
                    ) : (
                      <div className="max-h-52 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                        {tetherCapturesForProject.map((capture) => {
                          const display = getTetherCaptureDisplay(capture);
                          const previewSrc = getImageSrc(capture.image);
                          return (
                            <div key={capture.id} className="grid grid-cols-[40px_1fr_auto] gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
                              <div className="h-10 w-10 overflow-hidden rounded-lg border border-[var(--color-border)] bg-black/30">
                                {previewSrc ? (
                                  <img src={previewSrc} alt="" className="h-full w-full object-cover" loading="lazy" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <CameraIcon className="h-4 w-4 text-[var(--color-text-muted)] opacity-40" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold text-[var(--color-text)]">{capture.fileName}</p>
                                <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">{capture.message || 'Capture detected'}</p>
                              </div>
                              <span className={`self-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-[10px] font-semibold ${display.tone}`}>
                                {display.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
          )}

          {/* Scene Lock Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-muted)]">
                <LockIcon className="w-3 h-3 text-[var(--color-accent)]" />
                Scene Continuity
              </h2>
              {anchorImageId && (
                <button 
                  onClick={() => setAnchorImageId(null)}
                  className="text-xs font-semibold text-red-400/80 transition-colors hover:text-red-300"
                >
                  Clear
                </button>
              )}
            </div>
            
            <div className="space-y-3">
              <p className="text-sm leading-6 text-[var(--color-text-muted)]">
                Reuse the background, lighting direction, depth, and atmosphere from a finished edit when processing the next target.
              </p>
              
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1">
                {targetImages.filter(img => img.status === 'done' && img.generated).length === 0 ? (
                  <div className="col-span-3 py-6 text-center text-xs text-[var(--color-text-muted)] opacity-60">
                    No finished results
                  </div>
                ) : (
                  targetImages.filter(img => img.status === 'done' && img.generated).map(img => (
                    <button
                      key={img.id}
                      onClick={() => setAnchorImageId(img.id === anchorImageId ? null : img.id)}
                      className={`relative aspect-[3/4] overflow-hidden border transition-all rounded-sm ${
                        img.id === anchorImageId 
                          ? 'border-[var(--color-accent)]' 
                          : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
                      }`}
                    >
                      <img src={img.generated!} alt="Generated" className="w-full h-full object-cover" />
                      {img.id === anchorImageId && (
                        <div className="absolute inset-0 bg-[var(--color-accent)]/10 flex items-center justify-center">
                          <CheckIcon className="w-4 h-4 text-[var(--color-accent)] drop-shadow-md" />
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Project generation history */}
          <section ref={generationHistoryMenuRef} className={`relative ${isGenerationHistoryOpen ? 'z-50' : 'z-20'}`}>
            <button
              type="button"
              onClick={() => setIsGenerationHistoryOpen((isOpen) => !isOpen)}
              className="group flex w-full items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-left transition-all hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-hover)]"
              aria-expanded={isGenerationHistoryOpen}
              aria-controls="generation-history-menu"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <HistoryIcon className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[var(--color-text)]">Generation History</span>
                  <span className="block truncate text-[11px] text-[var(--color-text-muted)]">
                    {generationHistory.length === 0 ? 'No saved results yet' : `${generationHistory.length} project-backed result${generationHistory.length === 1 ? '' : 's'}`}
                  </span>
                </span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-2">
                <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[10px] font-semibold text-[var(--color-text-muted)]">
                  {generationHistory.length}
                </span>
                <ChevronDownIcon className={`h-4 w-4 text-[var(--color-text-muted)] transition-transform duration-200 ${isGenerationHistoryOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>

            <AnimatePresence>
              {isGenerationHistoryOpen && (
                <motion.div
                  id="generation-history-menu"
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute left-0 right-0 top-full mt-3 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl shadow-black/35"
                >
                  <div className="border-b border-[var(--color-border)] px-4 py-3">
                    <p className="text-xs leading-5 text-[var(--color-text-muted)]">
                      Saved generations reload with this project. Select one to restore it, or export directly.
                    </p>
                  </div>

                  {generationHistory.length === 0 ? (
                    <div className="p-5 text-center">
                      <HistoryIcon className="mx-auto mb-3 h-6 w-6 text-[var(--color-text-muted)] opacity-30" />
                      <p className="text-xs font-semibold text-[var(--color-text-muted)]">No generations saved yet</p>
                    </div>
                  ) : (
                    <div className="max-h-[360px] space-y-2 overflow-y-auto p-2 custom-scrollbar">
                      {generationHistory.map((item) => {
                        const isActiveHistory = activeTarget?.generated === item.generated;
                        const selectedSummary = item.settings?.selectedCategories
                          ?.slice(0, 2)
                          .map((category) => `${category.label} ${category.intensity}%`)
                          .join(' / ');

                        return (
                          <div
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              handleSelectGeneration(item);
                              setIsGenerationHistoryOpen(false);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleSelectGeneration(item);
                                setIsGenerationHistoryOpen(false);
                              }
                            }}
                            className={`group grid w-full grid-cols-[64px_1fr_auto] gap-3 rounded-xl border p-2 text-left transition-all ${
                              isActiveHistory
                                ? 'border-[var(--color-accent)] bg-[rgba(var(--color-accent-rgb),0.08)]'
                                : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-hover)]'
                            }`}
                          >
                            <span className="relative h-16 w-16 overflow-hidden rounded-lg bg-black/30">
                              <img
                                src={item.generated}
                                alt="Saved generation"
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            </span>
                            <span className="min-w-0 self-center">
                              <span className="block truncate text-xs font-semibold text-[var(--color-text)]">
                                {item.targetFileName || item.target?.fileName || 'Saved generation'}
                              </span>
                              <span className="mt-1 block text-[11px] text-[var(--color-text-muted)]">
                                {new Date(item.id).toLocaleString()}
                              </span>
                              {selectedSummary && (
                                <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-[var(--color-text-muted)]">
                                  {selectedSummary}
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleExportGeneration(item);
                              }}
                              className="flex h-8 w-8 items-center justify-center self-start rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] opacity-80 transition-all group-hover:opacity-100 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                              aria-label="Export saved generation"
                            >
                              <DownloadIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Reference analysis section */}
          <section className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-[var(--color-text-muted)]">Element control</h2>
            </div>
            
            <div className="min-h-[200px] relative">
              <AnimatePresence mode="wait">
                {isAnalyzing ? (
                  <motion.div 
                    key="analyzing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center space-y-4 p-4 text-center"
                  >
                    <div className="w-12 h-12 border-2 border-[var(--color-accent)]/20 border-t-[var(--color-accent)] rounded-full animate-spin" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-white">Reading visual DNA</p>
                    </div>
                  </motion.div>
                ) : checklist.length > 0 ? (
                  <motion.div 
                    key="checklist"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4"
                  >
                    <StyleChecklist
                      items={checklist}
                      onCheckChange={handleCheckChange}
                      onIntensityChange={handleIntensityChange}
                      disabled={isControlsLocked}
                      openCategoryId={openCategoryId}
                      onCategoryToggle={handleCategoryToggle}
                      onCustomTextChange={handleCustomTextChange}
                      onCustomTextStyleChange={handleCustomTextStyleChange}
                      onCustomPromptChange={handleCustomPromptChange}
                      onToggleAllInCategory={handleToggleAllInCategory}
                      onSubItemValueChange={handleSubItemValueChange}
                      customClothingItems={customClothingItems}
                      onCustomClothingUpload={handleCustomClothingUpload}
                      onCustomClothingToggle={handleCustomClothingToggle}
                      onRemoveCustomClothing={handleRemoveCustomClothing}
                      customAccessoryItems={customAccessoryItems}
                      onCustomAccessoryUpload={handleCustomAccessoryUpload}
                      onCustomAccessoryToggle={handleCustomAccessoryToggle}
                      onRemoveCustomAccessory={handleRemoveCustomAccessory}
                      customFaceItems={customFaceItems}
                      onCustomFaceUpload={handleCustomFaceUpload}
                      onCustomFaceToggle={handleCustomFaceToggle}
                      onRemoveCustomFace={handleRemoveCustomFace}
                      customBackgroundItem={customBackgroundItem}
                      onCustomBackgroundUpload={handleCustomBackgroundUpload}
                      onCustomBackgroundToggle={handleCustomBackgroundToggle}
                      onRemoveCustomBackground={handleRemoveCustomBackground}
                      customSkyItem={customSkyItem}
                      onCustomSkyUpload={handleCustomSkyUpload}
                      onCustomSkyToggle={handleCustomSkyToggle}
                      onRemoveCustomSky={handleRemoveCustomSky}
                    />
                  </motion.div>
                ) : (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-12 text-center"
                  >
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
                      <SparklesIcon className="w-5 h-5 text-[var(--color-text-muted)] opacity-20" />
                    </div>
                    <p className="mx-auto max-w-[230px] text-xs font-semibold leading-5 text-[var(--color-text-muted)]">Upload a reference photo to unlock background, relighting, style, and element controls.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>

        {/* Action Footer */}
        <div className="space-y-6 border-t border-[var(--color-border)] bg-[var(--color-header)] p-6">
          <div>
              <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-semibold text-[var(--color-text-muted)]">Output frame</label>
                  <span className="text-xs font-semibold text-[var(--color-accent)]">{aspectRatio || 'Original'}</span>
              </div>
              <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1 no-scrollbar">
                  {['1:1', '9:16', '16:9', '3:4', '4:3'].map((ratio) => (
                      <button
                          key={ratio}
                          onClick={() => setAspectRatio(aspectRatio === ratio ? undefined : ratio as AspectRatio)}
                          className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                              aspectRatio === ratio
                                  ? 'bg-[var(--color-accent)] text-black'
                                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-white'
                          }`}
                      >
                          {ratio}
                      </button>
                  ))}
              </div>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3"
            >
              <XCircleIcon className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                  <p className="text-xs font-semibold leading-relaxed text-red-300">{error}</p>
              </div>
            </motion.div>
          )}
          
          <div className="flex flex-col gap-2">
              {activeTargetIsProcessing ? (
                 <button 
                    onClick={handleCancelGeneration} 
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-6 py-4 text-sm font-semibold text-red-300 transition-all hover:bg-red-500 hover:text-white"
                 >
                     <XCircleIcon className="w-4 h-4" />
                     <span>Cancel generation</span>
                 </button>
              ) : (
                 <>
                     <button
                         onClick={handleQueueGeneration}
                         disabled={!isActionable}
                         className="primary-cta w-full py-4 text-sm transition-all disabled:opacity-20"
                     >
                         <div className="flex items-center justify-center gap-2">
                             <SparklesIcon className="w-4 h-4" />
                             <span>{getGenerateButtonText()}</span>
                         </div>
                     </button>
                     
                     <div className="flex gap-2">
                        {selectedCount > 0 && (
                            <button
                                onClick={handleQueueSelected}
                                disabled={!isActionable}
                                className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-3 text-xs font-semibold text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-hover)] disabled:opacity-20"
                            >
                                Process selected ({selectedCount})
                            </button>
                        )}

                        {selectedCount === 0 && targetImages.filter(t => t.status === 'pending' || t.status === 'error').length > 1 && (
                             <button 
                                 onClick={handleQueueAll} 
                                 disabled={!isActionable} 
                                 className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-3 text-xs font-semibold text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-hover)] disabled:opacity-20"
                             >
                                 Apply to batch ({targetImages.filter(t => t.status === 'pending' || t.status === 'error').length})
                             </button>
                        )}
                     </div>
                 </>
              )}
          </div>
        </div>
      </aside>
    </motion.div>
  );
};
