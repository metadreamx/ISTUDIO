
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { ImageState, StyleCategory, HistoryItem, BatchImage, CustomClothingItem, CustomAccessoryItem, CustomFaceItem, CustomBackgroundItem, CustomSkyItem, AspectRatio, Project } from '../types';
import { ImageUploader } from './ImageUploader';
import { MainPanel } from './MainPanel';
import { StyleChecklist } from './StyleChecklist';
import { analyzeTargetImageDetails, editImage, detectTransferableElements, analyzeClothingImage, analyzeAccessoryImage, analyzeFaceImage, analyzeBackgroundImage, analyzeSkyImage, analyzeReferenceScene } from '../services/geminiService';
import { SparklesIcon, XCircleIcon, CheckIcon, LockIcon, AdjustmentsHorizontalIcon, HistoryIcon, DownloadIcon } from '@/components/icons';

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

type GenerationStatus = 'idle' | 'analyzing_target' | 'generating' | 'saving';

interface StyleTransferViewProps {
    project: Project | null;
    onUpdateProject: (project: Project) => void;
    referenceTemplate?: ImageState | null;
    onReferenceTemplateConsumed?: () => void;
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

export const StyleTransferView: React.FC<StyleTransferViewProps> = ({ project, onUpdateProject, referenceTemplate, onReferenceTemplateConsumed }) => {
  const [referenceImage, setReferenceImage] = useState<ImageState>(createEmptyImage());
  const [targetImages, setTargetImages] = useState<BatchImage[]>([]);
  const [generationHistory, setGenerationHistory] = useState<HistoryItem[]>([]);
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
  
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());

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

  // Load project state
  useEffect(() => {
    const state = project?.state || {};
    const nextReference = state.referenceImage || createEmptyImage();
    const restoredTargets: BatchImage[] = Array.isArray(state.targetImages)
      ? state.targetImages.map((img: BatchImage) => ({
          ...img,
          status: (img.status === 'queued' || img.status === 'processing') ? 'pending' : img.status,
        }))
      : [];
    const restoredHistory: HistoryItem[] = Array.isArray(state.generationHistory)
      ? state.generationHistory
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
    lastAnalyzedRefBase64.current = nextReference.base64 || null;
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
    setGenerationStatus('idle');
    setError(null);
  }, [project?.id]); // Only re-load when project ID changes

  useEffect(() => {
    if (!referenceTemplate?.base64 || !referenceTemplate.mimeType) return;

    setReferenceImage(referenceTemplate);
    setChecklist([]);
    setSceneBlueprint(null);
    setAccentColor(null);
    setOpenCategoryId(null);
    lastAnalyzedRefBase64.current = null;
    onReferenceTemplateConsumed?.();
  }, [referenceTemplate?.base64, referenceTemplate?.mimeType, onReferenceTemplateConsumed]);

  // Persist project state
  useEffect(() => {
    if (project) {
        const generatedImages = Array.from(new Set([
            ...generationHistory.map(item => item.generated).filter((img): img is string => !!img),
            ...targetImages.map(img => img.generated).filter((img): img is string => !!img),
        ]));

        const updatedProject: Project = {
            ...project,
            lastModified: Date.now(),
            generatedImages,
            state: {
                ...(project.state || {}),
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
                generationHistory
            }
        };
        // Debounce or only save on specific changes to avoid excessive DB writes
        const timer = setTimeout(() => {
            onUpdateProject(updatedProject);
        }, 1000);
        return () => clearTimeout(timer);
    }
  }, [
    project?.id,
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
    onUpdateProject
  ]);

  const handleTargetImagesSelect = useCallback(async (imageStates: ImageState[]) => {
    const newBatchImages: BatchImage[] = await Promise.all(imageStates.map(async (state, index) => {
        const dominantColor = state.base64 && state.mimeType
            ? await getDominantColor(state.base64, state.mimeType)
            : null;
        return {
            id: `${state.fileName!}-${Date.now()}-${index}`,
            target: state,
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
        return updatedImages;
    });

  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let isCancelled = false;

    const processReferenceImage = async () => {
      const { base64, mimeType } = referenceImage;
      if (base64 && mimeType) {
        // Skip analysis if we already have a checklist for this image (e.g. on project load, or replaying the same reference)
        if (checklist.length > 0 && sceneBlueprint && referenceImage.base64 === lastAnalyzedRefBase64.current) {
            console.log("Reference image already matches current analysis, skipping...");
            return;
        }

        console.log("Starting reference image analysis...");
        setIsAnalyzing(true);
        setError(null);
        setChecklist([]);
        setSceneBlueprint(null);
        setOpenCategoryId(null);
        
        try {
          const results = await Promise.all([
            detectTransferableElements(base64),
            getDominantColor(base64, mimeType),
            analyzeReferenceScene(base64)
          ]);
          
          if (isCancelled) return;

          const [items, color, blueprint] = results;
          
          console.log("Analysis complete. Items found:", items.length);

          const itemsWithIntensity = items.map(category => ({
            ...category,
            intensity: 50
          }));
          setChecklist(itemsWithIntensity);
          setAccentColor(color);
          setSceneBlueprint(blueprint);
          setSessionSeed(Math.floor(Math.random() * 1000000));
          lastAnalyzedRefBase64.current = base64; // Track successful analysis
          if (itemsWithIntensity.length > 0) {
            setOpenCategoryId(itemsWithIntensity[0].id);
          }
        } catch (e) {
          if (isCancelled) return;
          console.error("Reference image analysis failed:", e);
          setError(e instanceof Error ? e.message : "Failed to process reference image.");
          setAccentColor(null);
          setSessionSeed(null);
        } finally {
          if (!isCancelled) {
            setIsAnalyzing(false);
          }
        }
      } else {
        setChecklist([]);
        setAccentColor(null);
        setSessionSeed(null);
      }
    };
    processReferenceImage();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [referenceImage.base64, referenceImage.mimeType]);

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

  const handleCustomClothingUpload = useCallback(async (gender: 'man' | 'woman', id: string, imageState: ImageState) => {
    setCustomClothingItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, image: imageState, status: 'analyzing' } : item) }));
    try {
      const analysis = await analyzeClothingImage(imageState.base64!);
      setCustomClothingItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, analysis, status: 'ready' } : item) }));
    } catch (e) {
      console.error("Clothing analysis failed:", e);
      setCustomClothingItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, status: 'error' } : item) }));
    }
  }, []);

  const handleCustomClothingToggle = useCallback((gender: 'man' | 'woman', id: string, enabled: boolean) => {
    setCustomClothingItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, enabled } : item) }));
  }, []);

  const handleRemoveCustomClothing = useCallback((gender: 'man' | 'woman', id: string) => {
    setCustomClothingItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, image: { fileName: null, base64: null, mimeType: null }, analysis: null, enabled: false, status: 'empty' } : item) }));
  }, []);
  
  const handleCustomAccessoryUpload = useCallback(async (gender: 'man' | 'woman', id: string, imageState: ImageState) => {
    setCustomAccessoryItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, image: imageState, status: 'analyzing' } : item) }));
    try {
      const analysis = await analyzeAccessoryImage(imageState.base64!);
      setCustomAccessoryItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, analysis, status: 'ready' } : item) }));
    } catch (e) {
      console.error("Accessory analysis failed:", e);
      setCustomAccessoryItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, status: 'error' } : item) }));
    }
  }, []);

  const handleCustomAccessoryToggle = useCallback((gender: 'man' | 'woman', id: string, enabled: boolean) => {
    setCustomAccessoryItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, enabled } : item) }));
  }, []);

  const handleRemoveCustomAccessory = useCallback((gender: 'man' | 'woman', id: string) => {
    setCustomAccessoryItems(prev => ({ ...prev, [gender]: prev[gender].map(item => item.id === id ? { ...item, image: { fileName: null, base64: null, mimeType: null }, analysis: null, enabled: false, status: 'empty' } : item) }));
  }, []);
  
  const handleCustomFaceUpload = useCallback(async (gender: 'man' | 'woman', imageState: ImageState) => {
    setCustomFaceItems(prev => ({ ...prev, [gender]: { ...prev[gender], image: imageState, status: 'analyzing' } }));
    try {
      const analysis = await analyzeFaceImage(imageState.base64!);
      setCustomFaceItems(prev => ({ ...prev, [gender]: { ...prev[gender], analysis, status: 'ready' } }));
    } catch (e) {
      console.error("Face analysis failed:", e);
      setCustomFaceItems(prev => ({ ...prev, [gender]: { ...prev[gender], status: 'error' } }));
    }
  }, []);

  const handleCustomFaceToggle = useCallback((gender: 'man' | 'woman', enabled: boolean) => {
    setCustomFaceItems(prev => ({ ...prev, [gender]: { ...prev[gender], enabled } }));
  }, []);

  const handleRemoveCustomFace = useCallback((gender: 'man' | 'woman') => {
    setCustomFaceItems(prev => ({ ...prev, [gender]: createInitialFaceItem() }));
  }, []);
  
  const handleCustomBackgroundUpload = useCallback(async (imageState: ImageState) => {
    setCustomBackgroundItem(prev => ({ ...prev, image: imageState, status: 'analyzing' }));
    try {
      const analysis = await analyzeBackgroundImage(imageState.base64!);
      setCustomBackgroundItem(prev => ({ ...prev, analysis, status: 'ready' }));
    } catch (e) {
      console.error("Background analysis failed:", e);
      setCustomBackgroundItem(prev => ({ ...prev, status: 'error' }));
    }
  }, []);

  const handleCustomBackgroundToggle = useCallback((enabled: boolean) => {
    setCustomBackgroundItem(prev => ({ ...prev, enabled }));
  }, []);

  const handleRemoveCustomBackground = useCallback(() => {
    setCustomBackgroundItem(createInitialBackgroundItem());
  }, []);

  const handleCustomSkyUpload = useCallback(async (imageState: ImageState) => {
    setCustomSkyItem(prev => ({ ...prev, image: imageState, status: 'analyzing' }));
    try {
      const analysis = await analyzeSkyImage(imageState.base64!);
      setCustomSkyItem(prev => ({ ...prev, analysis, status: 'ready' }));
    } catch (e) {
      console.error("Sky analysis failed:", e);
      setCustomSkyItem(prev => ({ ...prev, status: 'error' }));
    }
  }, []);

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
        .filter((item) => item.enabled && item.status === 'ready' && item.image.base64)
        .forEach((item, index) => customAssets.push(`${gender} clothing ${index + 1}: ${item.image.fileName || 'custom image'}`));
      customAccessoryItems[gender]
        .filter((item) => item.enabled && item.status === 'ready' && item.image.base64)
        .forEach((item, index) => customAssets.push(`${gender} accessory ${index + 1}: ${item.image.fileName || 'custom image'}`));
      const faceItem = customFaceItems[gender];
      if (faceItem.enabled && faceItem.status === 'ready' && faceItem.image.base64) {
        customAssets.push(`${gender} face: ${faceItem.image.fileName || 'custom image'}`);
      }
    });

    if (customBackgroundItem.enabled && customBackgroundItem.status === 'ready' && customBackgroundItem.image.base64) {
      customAssets.push(`background: ${customBackgroundItem.image.fileName || 'custom image'}`);
    }
    if (customSkyItem.enabled && customSkyItem.status === 'ready' && customSkyItem.image.base64) {
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
    if (!imageToProcess || !referenceImage.base64 || !referenceImage.mimeType) {
        return; 
    }
    
    cancelGenerationRef.current = false;
    setTargetImages(prev => prev.map((img, idx) => idx === imageIndex ? { ...img, status: 'processing' } : img));

    try {
        setGenerationStatus('analyzing_target');
        const targetImageAnalysis = await analyzeTargetImageDetails(imageToProcess.target.base64!);
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
            const activeItems = items.filter(item => item && item.enabled && item.status === 'ready' && item.image.base64);
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
            const facePrompt = processCustomItemsForPrompt(gender, faceItem.image.base64 ? [faceItem] : [], 'FACE');
            if (facePrompt) specialInstructionParts.push(facePrompt);
        });

        if (customBackgroundItem.enabled && customBackgroundItem.status === 'ready' && customBackgroundItem.image.base64) {
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

        if (customSkyItem.enabled && customSkyItem.status === 'ready' && customSkyItem.image.base64) {
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

        const anchorSceneInstruction = isStatefulIteration ? `
---
**STATEFUL ITERATION MODE (CRITICAL)**
You have been provided with an additional image: the **ANCHOR SCENE** (Image 2).
This is a "Persistent Scene Diffusion Engine". 
- **BACKGROUND SOURCE:** You MUST extract the EXACT background, lighting, depth, and layout from the Anchor Scene (Image 2).
- **SUBJECT SOURCE (CRITICAL):** You MUST extract the subject from the Target Image (Image 1). 
- **SUBJECT REPLACEMENT:** You are STRICTLY FORBIDDEN from copying the subject, pose, or identity from the Anchor Scene (Image 2). The subject in Image 2 is a placeholder. You must completely replace them with the subject from Image 1.
- **COMPOSITING:** Composite the subject from Image 1 seamlessly into the EXACT background of Image 2. The subject MUST look like they were physically present in that exact room/environment when the photo was taken. Pay extreme attention to matching the lighting, shadows, and scale of Image 2.
Apply the style from the Reference Image with a decay factor (alpha) to prevent over-stylization, focusing primarily on blending the subject realistically into the established scene.
---
` : '';

        const prompt = `
**IMAGE INPUTS:**
- IMAGE 1: The Target Image (Subject to be styled and composited).
${isStatefulIteration ? '- IMAGE 2: The Anchor Scene (The exact background and lighting environment to reuse).' : ''}
- SUBSEQUENT IMAGES (if any): Custom elements (clothing, accessories, faces, backgrounds) to apply.

**PRIME DIRECTIVE: ABSOLUTE GEOMETRIC LOCK & SUBJECT INTEGRITY (NON-NEGOTIABLE)**
1. **GEOMETRIC LOCK:** You must treat the Target Image (Image 1) as a rigid, immutable structural wireframe. You are strictly forbidden from modifying the subject's pose, position, scale, or framing. This includes the exact position of arms, head, fingers, and body posture.
2. **SUBJECT INTEGRITY:** The subject's anatomy and physical state must remain 100% identical to Image 1. You are only transforming the aesthetic, lighting, and environment.
3. **STYLE PRECISION:** You MUST strictly adhere to the provided Intensity percentages for each style category. 
   - 0-25%: Barely perceptible influence.
   - 26-50%: Balanced blend.
   - 51-75%: Strong stylistic dominance.
   - 76-100%: Total stylistic takeover.

**ROLE & GOAL**
You are an Elite Photorealistic Compositing and Style Transfer Engine. Your absolute top priority is UNCOMPROMISING REALISM while PRESERVING THE PHOTOGRAPHER'S ORIGINAL POSE. Every generation must look like a genuine, unedited photograph. The subject must be seamlessly integrated into the environment without moving a single limb or changing their head tilt.

${anchorSceneInstruction}

1.  **ULTIMATE REALISM & COMPOSITING (TOP PRIORITY):**
    - **GROUNDING & PLACEMENT:** The subject must be perfectly grounded in the scene. No floating subjects. You MUST generate appropriate contact shadows that match the scene's lighting direction and quality.
    - **SCALE & PERSPECTIVE:** The subject's scale and perspective must be realistically adjusted to fit the environment. Match the camera angle and focal length implied by the background.
    - **LIGHTING MATCH:** The lighting on the subject MUST perfectly match the environmental lighting of the scene. Replicate the light direction, quality (soft/hard), color temperature, and ambient bounce light.
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
    - **PIXEL-PERFECT POSITION:** The subject's core position should be consistent with Image 1, but adjusted for realistic grounding and perspective within the new environment.
    - **NO RESIZING/RATIO CHANGE:** You are FORBIDDEN from changing the overall image aspect ratio.
    ${!aspectRatio ? '- **NO OUTPAINTING**: Do NOT generate outside the original image boundaries.' : ''}

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
`;
        if (cancelGenerationRef.current) throw new Error("Cancelled");
        
        const activeItems = [
            ...customClothingItems.woman, ...customClothingItems.man,
            ...customAccessoryItems.woman, ...customAccessoryItems.man,
            customFaceItems.woman, customFaceItems.man
        ].filter(item => item.enabled && item.status === 'ready' && item.image.base64);

        const imageParts = [
            { inlineData: { data: imageToProcess.target.base64!, mimeType: imageToProcess.target.mimeType! }}
        ];

        if (isStatefulIteration && anchorScene?.generated) {
            const base64Data = anchorScene.generated.split(',')[1];
            imageParts.push({
                inlineData: { data: base64Data, mimeType: 'image/png' }
            });
        }

        imageParts.push(...activeItems.map(item => ({ inlineData: { data: item.image.base64!, mimeType: item.image.mimeType! }})));

        if (customBackgroundItem.enabled && customBackgroundItem.status === 'ready' && customBackgroundItem.image.base64) {
            imageParts.push({
                inlineData: { data: customBackgroundItem.image.base64, mimeType: customBackgroundItem.image.mimeType! }
            });
        }

        if (customSkyItem.enabled && customSkyItem.status === 'ready' && customSkyItem.image.base64) {
            imageParts.push({
                inlineData: { data: customSkyItem.image.base64, mimeType: customSkyItem.image.mimeType! }
            });
        }

        const seed = (isStatefulIteration && sessionSeed) ? sessionSeed : Math.floor(Math.random() * 1000000);
        const newImageBase64 = await editImage(imageParts, prompt, aspectRatio, seed);
        if (cancelGenerationRef.current) throw new Error("Cancelled");

        const newImageSrc = `data:image/png;base64,${newImageBase64}`;
        const generationId = Date.now();
        const historyItem: HistoryItem = {
          id: generationId,
          projectId: project?.id || 'live-session',
          generated: newImageSrc,
          target: {
            fileName: imageToProcess.target.fileName,
            base64: imageToProcess.target.base64,
            mimeType: imageToProcess.target.mimeType,
          },
          reference: {
            fileName: referenceImage.fileName,
            base64: referenceImage.base64,
            mimeType: referenceImage.mimeType,
          },
          targetId: imageToProcess.id,
          targetFileName: imageToProcess.target.fileName,
          settings: getGenerationSettingsSnapshot(),
        };

        // Update state to show image
        setTargetImages(prev => prev.map((img, idx) => idx === imageIndex ? { ...img, status: 'done', generated: newImageSrc } : img));
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
    if (!referenceImage.base64 || !referenceImage.mimeType) {
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
    if (!referenceImage.base64 || !referenceImage.mimeType) {
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
    if (!referenceImage.base64 || !referenceImage.mimeType) {
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

  const isActionable = !isAnalyzing && !!activeTarget && !['queued', 'processing'].includes(activeTarget.status) && !!referenceImage.base64 && (checklist.length > 0 || hasActiveCustomItems);

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

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg)] lg:flex-row"
      style={{'--dynamic-accent-color': accentColor || 'var(--color-accent)'} as React.CSSProperties}
    >
      {/* Mobile Toggle Button */}
      <button 
        onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        className="fixed bottom-6 right-6 z-[100] flex h-14 w-14 items-center justify-center rounded-full border-4 border-black bg-[var(--color-accent)] text-black shadow-2xl transition-transform active:scale-95 lg:hidden"
        aria-label="Toggle style controls"
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
                <AdjustmentsHorizontalIcon className="w-6 h-6" />
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
              onReferenceImageSelect={setReferenceImage}
              referenceDominantColor={accentColor}
              selectedImageIds={selectedImageIds}
              onToggleImageSelection={handleToggleSelection}
            />
        </div>
      </main>

      {/* --- Sidebar (Right) --- */}
      <aside className={`fixed inset-0 z-[90] flex w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl transition-transform duration-500 ease-in-out lg:relative lg:inset-auto lg:z-30 lg:w-full lg:max-w-[360px] xl:max-w-[400px] ${
        isMobileSidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
      }`}>
        {/* Mobile Sidebar Close Backdrop */}
        <AnimatePresence>
          {isMobileSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileSidebarOpen(false)}
              className="lg:hidden absolute inset-0 -translate-x-full bg-black/60 backdrop-blur-sm z-[-1]"
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
              {referenceImage.base64 && (
                <button 
                  onClick={() => setReferenceImage({ fileName: null, base64: null, mimeType: null })}
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
                onImageSelect={setReferenceImage}
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
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-muted)]">
                <HistoryIcon className="h-3 w-3 text-[var(--color-accent)]" />
                Generation History
              </h2>
              <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-[10px] font-semibold text-[var(--color-text-muted)]">
                {generationHistory.length}
              </span>
            </div>

            <div className="space-y-3">
              <p className="text-sm leading-6 text-[var(--color-text-muted)]">
                Every saved result for this project is stored in the project folder and reloads with the edit.
              </p>

              {generationHistory.length === 0 ? (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 text-center">
                  <HistoryIcon className="mx-auto mb-3 h-6 w-6 text-[var(--color-text-muted)] opacity-30" />
                  <p className="text-xs font-semibold text-[var(--color-text-muted)]">No generations saved yet</p>
                </div>
              ) : (
                <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
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
                        onClick={() => handleSelectGeneration(item)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleSelectGeneration(item);
                          }
                        }}
                        className={`group grid w-full grid-cols-[72px_1fr_auto] gap-3 rounded-xl border p-2 text-left transition-all ${
                          isActiveHistory
                            ? 'border-[var(--color-accent)] bg-[rgba(var(--color-accent-rgb),0.08)]'
                            : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-hover)]'
                        }`}
                      >
                        <img
                          src={item.generated}
                          alt="Saved generation"
                          className="h-[72px] w-[72px] rounded-lg object-cover"
                          loading="lazy"
                        />
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
            </div>
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
