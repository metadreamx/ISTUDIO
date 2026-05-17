
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import type { ImageState, BatchImage, ExportFormat } from '../types';
import { UploadIcon, SpinnerIcon, DownloadIcon, ZoomInIcon, ZoomOutIcon, ResetIcon, SingleViewIcon, SideBySideViewIcon, CheckCircleIcon, CloseIcon, XCircleIcon, HistoryIcon, SparklesIcon, CheckIcon, PlusIcon } from '@/components/icons';
import { ImageUploader } from './ImageUploader';
import { Tooltip } from './Tooltip';
import JSZip from 'jszip';
import { processAndResizeImage } from '../services/geminiService';
import { getImageSrc } from '../services/imageAssets';

type GenerationStatus = 'idle' | 'analyzing_target' | 'generating' | 'saving';

// Helper to convert a data URL to a different format if needed
const convertDataUrl = async (dataUrl: string, format: ExportFormat, quality: number): Promise<{dataUrl: string, mime: string}> => {
    if (format === 'png') {
        // If the source is already PNG, no conversion needed. Otherwise, it needs conversion.
        if (dataUrl.startsWith('data:image/png')) return { dataUrl, mime: 'image/png' };
    }
    if (format === 'jpeg' && dataUrl.startsWith('data:image/jpeg')) return { dataUrl, mime: 'image/jpeg' };

    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve({ dataUrl, mime: 'image/png' }); // fallback
                return;
            };
            ctx.drawImage(img, 0, 0);
            const targetMime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
            const convertedDataUrl = canvas.toDataURL(targetMime, format === 'jpeg' ? quality / 100 : undefined);
            resolve({ dataUrl: convertedDataUrl, mime: targetMime });
        };
        img.onerror = () => resolve({ dataUrl, mime: 'image/png' }); // fallback on error
        img.src = dataUrl;
    });
};

const sourceToDataUrl = async (source: string): Promise<string> => {
    if (source.startsWith('data:')) return source;
    const response = await fetch(source);
    if (!response.ok) {
        throw new Error('Could not load the saved image for export.');
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the saved image for export.'));
        reader.readAsDataURL(blob);
    });
};

const LoadingStep: React.FC<{ title: string; status: 'pending' | 'active' | 'done' }> = ({ title, status }) => {
  const statusClasses = {
    pending: 'text-white/20',
    active: 'text-[var(--color-accent)]',
    done: 'text-emerald-500',
  };

  const Icon = () => {
    switch (status) {
      case 'active':
        return <SpinnerIcon className="w-5 h-5 animate-spin" />;
      case 'done':
        return <CheckIcon className="w-5 h-5" />;
      default:
        return <div className="w-4 h-4 border border-white/10 rounded-sm"></div>;
    }
  };

  return (
    <div className={`flex items-center gap-4 transition-opacity duration-300 ${status === 'pending' ? 'opacity-30' : 'opacity-100'}`}>
      <div className={`transition-colors duration-300 w-5 h-5 flex items-center justify-center ${statusClasses[status]}`}>
        <Icon />
      </div>
      <span className={`text-xs font-semibold transition-colors duration-300 ${statusClasses[status]}`}>{title}</span>
    </div>
  );
};

const ImageStrip: React.FC<{
    images: BatchImage[];
    activeIndex: number;
    onSelect: (index: number) => void;
    onRemove: (id: string) => void;
    selectedIds: Set<string>;
    onToggleSelection: (id: string) => void;
}> = ({ images, activeIndex, onSelect, onRemove, selectedIds, onToggleSelection }) => {
    const activeRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (activeRef.current) {
            activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [activeIndex]);

    if (images.length === 0) return null;

    const renderThumb = (image: BatchImage, index: number, size: 'compact' | 'desktop') => {
        const isActive = index === activeIndex;
        const isSelected = selectedIds.has(image.id);
        const targetSrc = getImageSrc(image.target);
        const generatedSrc = image.generated;
        const isCompact = size === 'compact';

        return (
            <div key={`${size}-${image.id}`} ref={isActive ? activeRef : null} className="relative flex-shrink-0 group">
                <button
                    onClick={() => onSelect(index)}
                    className={`${isCompact ? 'h-20 w-16 rounded-xl' : 'h-14 w-14 rounded-lg'} overflow-hidden border bg-black/35 transition-all duration-300 ${
                        isActive
                            ? 'border-[var(--color-accent)] opacity-100 shadow-[0_0_0_3px_rgba(var(--color-accent-rgb),0.12)]'
                            : 'border-[var(--color-border)] opacity-65 hover:border-[var(--color-border-hover)] hover:opacity-100'
                    }`}
                    aria-label={`Select image ${index + 1}`}
                    aria-current={isActive}
                >
                    {targetSrc && <img src={targetSrc} className="h-full w-full object-cover" alt={`Target image ${index + 1}`} />}
                </button>

                <button
                    onClick={(e) => { e.stopPropagation(); onToggleSelection(image.id); }}
                    className={`absolute left-1 top-1 z-30 flex ${isCompact ? 'h-5 w-5 rounded-md' : 'h-4 w-4 rounded-sm'} items-center justify-center border transition-all ${
                        isSelected
                            ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-black opacity-100'
                            : 'bg-black/70 border-white/20 text-transparent hover:border-[var(--color-accent)] opacity-0 group-hover:opacity-100'
                    }`}
                    aria-label={`Select image ${index + 1} for batching`}
                >
                    <CheckIcon className={isCompact ? 'h-3 w-3' : 'h-2.5 w-2.5'} />
                </button>

                {(image.status !== 'pending' && image.status !== 'done' || generatedSrc) && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/35">
                        {image.status === 'queued' && <HistoryIcon className="h-4 w-4 text-white/60" />}
                        {image.status === 'processing' && <SpinnerIcon className="h-4 w-4 animate-spin text-[var(--color-accent)]" />}
                        {image.status === 'done' && generatedSrc && (
                            <img src={generatedSrc} className="h-full w-full rounded-[inherit] border border-[var(--color-accent)]/30 object-cover" alt={`Generated image ${index + 1}`} />
                        )}
                        {image.status === 'error' && <XCircleIcon className="h-5 w-5 text-red-500" />}
                    </div>
                )}
                {image.status === 'done' && <CheckCircleIcon className={`absolute right-0 top-0 z-20 ${isCompact ? 'h-4 w-4' : 'h-3 w-3'} rounded-full bg-black text-[var(--color-accent)]`} />}

                <button
                    onClick={(e) => { e.stopPropagation(); onRemove(image.id); }}
                    className="absolute bottom-1 right-1 z-30 rounded-md border border-red-500/30 bg-red-950/80 p-0.5 text-red-400 opacity-0 transition-all hover:bg-red-500 hover:text-white group-hover:opacity-100"
                    aria-label={`Remove image ${index + 1}`}
                >
                    <CloseIcon className={isCompact ? 'h-3 w-3' : 'h-2.5 w-2.5'} />
                </button>
            </div>
        );
    };

    return (
        <>
            {images.length > 1 && (
                <div className="absolute bottom-[60px] left-0 right-0 z-40 hidden w-full border-t border-[var(--color-border)] bg-[var(--color-header)]/95 backdrop-blur-xl lg:block">
                    <div className="flex gap-3 overflow-x-auto px-6 py-3 shadow-2xl custom-scrollbar">
                        {images.map((image, index) => renderThumb(image, index, 'desktop'))}
                    </div>
                </div>
            )}

            <div className="mobile-image-tray shrink-0 border-t border-[var(--color-border)] bg-black/92 px-3 py-3 backdrop-blur-xl lg:hidden">
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                    {images.map((image, index) => renderThumb(image, index, 'compact'))}
                </div>
            </div>
        </>
    );
};

interface MainPanelProps {
  activeTarget: BatchImage | null;
  allTargets: BatchImage[];
  activeIndex: number;
  onSelectIndex: (index: number) => void;
  onImagesSelect: (states: ImageState[]) => void | Promise<void>;
  onRemoveImage: (id: string) => void;
  generationStatus: GenerationStatus;
  referenceImage: ImageState;
  onReferenceImageSelect: (state: ImageState) => void;
  referenceDominantColor?: string | null;
  selectedImageIds: Set<string>;
  onToggleImageSelection: (id: string) => void;
  onGenerate: () => void;
  onCancelGeneration: () => void;
  isActionable: boolean;
  isProcessing: boolean;
  generateButtonText: string;
}

export const MainPanel: React.FC<MainPanelProps> = ({
  activeTarget,
  allTargets,
  activeIndex,
  onSelectIndex,
  onImagesSelect,
  onRemoveImage,
  generationStatus,
  referenceImage,
  onReferenceImageSelect,
  referenceDominantColor,
  selectedImageIds,
  onToggleImageSelection,
  onGenerate,
  onCancelGeneration,
  isActionable,
  isProcessing,
  generateButtonText,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<'single' | 'side-by-side'>('side-by-side');
  const [activeImage, setActiveImage] = useState<'target' | 'generated'>('generated');
  const [animateIn, setAnimateIn] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportQuality, setExportQuality] = useState(96);
  const [isZipping, setIsZipping] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  const singleViewRef = useRef<ReactZoomPanPinchRef | null>(null);
  const originalSideRef = useRef<ReactZoomPanPinchRef | null>(null);
  const styledSideRef = useRef<ReactZoomPanPinchRef | null>(null);
  
  const isSyncing = useRef(false);
  const prevActiveTargetIdRef = useRef<string | undefined>(undefined);

  const handleTransform = (ref: ReactZoomPanPinchRef, state: { scale: number }) => {
    setZoomLevel(state.scale);
  };

  useEffect(() => {
    const isSwitchingImages = prevActiveTargetIdRef.current !== activeTarget?.id;

    if (activeTarget?.generated) {
      if (!isSwitchingImages) {
        setViewMode('side-by-side');
        setActiveImage('generated');
        setAnimateIn(true);
        const timer = setTimeout(() => setAnimateIn(false), 800);
        return () => clearTimeout(timer);
      } else {
        setActiveImage('generated');
        setViewMode('side-by-side');
      }
    } else if (activeTarget) {
      setActiveImage('target');
      setViewMode('side-by-side');
    }

    if (isSwitchingImages) {
      setTimeout(() => {
        singleViewRef.current?.resetTransform();
        originalSideRef.current?.resetTransform();
        styledSideRef.current?.resetTransform();
      }, 0);
    }
    
    prevActiveTargetIdRef.current = activeTarget?.id;
  }, [activeTarget]);
  
  useEffect(() => {
    if (viewMode === 'side-by-side') {
      setTimeout(() => {
        originalSideRef.current?.resetTransform();
        styledSideRef.current?.resetTransform();
      }, 0);
    }
  }, [viewMode]);
  
  const processFiles = useCallback(async (files: File[]) => {
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      const mode = imageFiles.length > 1 ? 'batch' : 'single';
      for (const file of imageFiles) {
          try {
              const image = await processAndResizeImage(file, mode);
              await onImagesSelect([image]);
          } catch (e) {
              console.error(`Failed to process ${file.name}:`, e);
              alert(e instanceof Error ? e.message : `Failed to process ${file.name}`);
          }
      }
  }, [onImagesSelect]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      processFiles(files);
    }
    event.target.value = '';
  }, [processFiles]);

  const handleContainerClick = () => {
    if (!activeTarget) {
        inputRef.current?.click();
    }
  };

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);
  
  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeTarget) {
        setIsDragging(true);
    }
  }, [activeTarget]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) {
      processFiles(files);
    }
  }, [processFiles]);
  
  const handleSingleDownload = useCallback(async () => {
    if (activeTarget?.generated) {
      const generatedDataUrl = await sourceToDataUrl(activeTarget.generated);
      const { dataUrl } = await convertDataUrl(generatedDataUrl, exportFormat, exportQuality);
      const link = document.createElement('a');
      link.href = dataUrl;
      const originalName = activeTarget.target.fileName!.replace(/\.[^/.]+$/, "");
      link.download = `${originalName}-styled.${exportFormat}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setIsDownloadModalOpen(false);
  }, [activeTarget, exportFormat, exportQuality]);

  const handleAllDownload = useCallback(async () => {
    setIsZipping(true);
    const zip = new JSZip();
    const generatedImages = allTargets.filter(img => img.status === 'done' && img.generated);

    if (generatedImages.length === 0) {
      setIsZipping(false);
      return;
    }

    for (const image of generatedImages) {
        const generatedDataUrl = await sourceToDataUrl(image.generated!);
        const { dataUrl } = await convertDataUrl(generatedDataUrl, exportFormat, exportQuality);
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const originalName = image.target.fileName!.replace(/\.[^/.]+$/, "");
        zip.file(`${originalName}-styled.${exportFormat}`, blob);
    }

    zip.generateAsync({ type: 'blob' }).then((content) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = 'IStudio_Batch_Export.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    });
    
    setIsZipping(false);
    setIsDownloadModalOpen(false);
  }, [allTargets, exportFormat, exportQuality]);

  const handleZoomIn = () => {
    if (viewMode === 'side-by-side') {
      originalSideRef.current?.zoomIn();
    } else {
      singleViewRef.current?.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (viewMode === 'side-by-side') {
      originalSideRef.current?.zoomOut();
    } else {
      singleViewRef.current?.zoomOut();
    }
  };

  const handleResetTransform = () => {
    if (viewMode === 'side-by-side') {
      originalSideRef.current?.resetTransform();
      styledSideRef.current?.resetTransform();
    } else {
      singleViewRef.current?.resetTransform();
    }
  };
  
  const handleOriginalTransform = (ref: ReactZoomPanPinchRef, state: { scale: number; positionX: number; positionY: number; }) => {
    setZoomLevel(state.scale);
    if (isSyncing.current) return;
    isSyncing.current = true;
    styledSideRef.current?.setTransform(state.positionX, state.positionY, state.scale, 0);
    isSyncing.current = false;
  };
  
  const handleStyledTransform = (ref: ReactZoomPanPinchRef, state: { scale: number; positionX: number; positionY: number; }) => {
    setZoomLevel(state.scale);
    if (isSyncing.current) return;
    isSyncing.current = true;
    originalSideRef.current?.setTransform(state.positionX, state.positionY, state.scale, 0);
    isSyncing.current = false;
  };
  
  const glowStyle: React.CSSProperties = activeTarget?.dominantColor ? {
    boxShadow: `0 0 50px 10px ${activeTarget.dominantColor.replace('rgb', 'rgba').replace(')', ', 0.3)')}`,
  } : {};
  const activeTargetSrc = getImageSrc(activeTarget?.target);
  
  const steps = [
    { id: 'analyzing_target', title: 'Reading target photo' },
    { id: 'generating', title: 'Applying reference DNA' },
    { id: 'saving', title: 'Blending and saving edit' },
  ];
  const currentStepIndex = steps.findIndex(s => s.id === generationStatus);

  const GenerationPlaceholder = () => (
    <div className="w-full h-full flex items-center justify-center">
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/75 p-7 text-center text-[var(--color-text-muted)] shadow-[var(--shadow-card)]">
            <SparklesIcon className="mx-auto mb-3 h-9 w-9 text-[var(--color-accent)] opacity-80" />
            <p className="text-sm font-semibold text-[var(--color-text)]">Ready for reference edit</p>
            <p className="mt-1 text-xs">Choose the DNA to inherit, then generate a controlled result.</p>
        </div>
    </div>
  );

  return (
    <>
      <div 
          className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--color-viewport)]"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
      >
        <input
          id="target-image-input"
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          multiple
        />
        <div className="relative min-h-0 w-full flex-1 bg-[var(--color-viewport)]">
          <div className="hidden absolute top-4 left-4 z-20 w-28 h-28 lg:block">
              <ImageUploader
                  id="reference-image-mobile"
                  title="Reference"
                  subtitle=""
                  image={referenceImage}
                  onImageSelect={onReferenceImageSelect}
                  dominantColor={referenceDominantColor}
                  compact
              />
          </div>

          {!activeTarget ? (
            <div 
              className={`group flex h-full w-full cursor-pointer items-center justify-center p-6 transition-colors duration-300 ${isDragging ? 'bg-[var(--color-accent)]/10' : ''}`}
              onClick={handleContainerClick}
            >
              <div className="w-full max-w-lg rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/90 p-10 text-center shadow-[var(--shadow-card)] transition-colors group-hover:border-[var(--color-accent)]/50">
                <div className={`mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-lg border transition-all duration-300 ${isDragging ? 'scale-105 border-[var(--color-accent)] bg-[var(--color-accent)]/20' : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]'}`}>
                  <UploadIcon className={`h-7 w-7 ${isDragging ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)]'} transition-colors`} />
                </div>
                <h3 className="mb-2 text-xl font-semibold text-[var(--color-text)]">{isDragging ? 'Drop target photos' : 'Import target photos'}</h3>
                <p className="mx-auto max-w-sm text-sm leading-6 text-[var(--color-text-muted)]">{isDragging ? 'They will appear in the review filmstrip.' : 'Drag in one photo or a batch, then apply the reference DNA with precise controls.'}</p>
              </div>
            </div>
          ) : (
            <div className={`w-full h-full transition-[filter,transform] duration-500 ${activeTarget.status === 'processing' ? 'filter blur-2xl brightness-50 scale-105' : ''}`}>
              <div className={`w-full h-full ${viewMode === 'single' ? 'p-2 sm:p-4 lg:p-8' : 'hidden'}`}>
                <TransformWrapper ref={singleViewRef} initialScale={1} centerOnInit={true} onTransformed={(ref, state) => handleTransform(ref, state)}>
                  <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                    {activeImage === 'generated' && !activeTarget.generated ? (
                        <GenerationPlaceholder />
                    ) : (
                      <img
                          src={activeImage === 'generated'
                            ? activeTarget.generated!
                            : activeTargetSrc || ''}
                          alt={activeImage === 'target' ? "Target" : "Generated"}
                          className={`max-w-full max-h-full object-contain block rounded shadow-2xl transition-[opacity,filter,transform] duration-700 ${
                              activeImage === 'generated' && animateIn ? 'frosted-fade-in' : ''
                          }`}
                          style={activeImage === 'target' ? glowStyle : {}}
                      />
                    )}
                  </TransformComponent>
                </TransformWrapper>
              </div>

              <div className={`h-full w-full bg-[var(--color-viewport)] md:overflow-x-auto ${viewMode === 'side-by-side' ? 'block' : 'hidden'}`}>
                <div className="grid h-full min-w-0 grid-cols-2 gap-1.5 p-2 md:min-w-[720px] md:gap-3 md:p-3 lg:min-w-0 lg:gap-4 lg:p-8">
                <div className="group relative min-h-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl sm:rounded-2xl">
                  <TransformWrapper ref={originalSideRef} initialScale={1} centerOnInit={true} onTransformed={handleOriginalTransform}>
                    <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                      {activeTargetSrc && <img src={activeTargetSrc} alt="Original" className="max-w-full max-h-full object-contain block" />}
                    </TransformComponent>
                  </TransformWrapper>
                  <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[10px] font-semibold text-white/75 sm:left-4 sm:top-4 sm:px-2.5 sm:text-xs">Target</div>
                </div>
                <div className="group relative min-h-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl sm:rounded-2xl">
                  <TransformWrapper ref={styledSideRef} initialScale={1} centerOnInit={true} onTransformed={handleStyledTransform}>
                    <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                      {activeTarget.generated ? (
                        <img 
                          src={activeTarget.generated}
                          alt="Generated" 
                          className={`max-w-full max-h-full object-contain block ${
                                animateIn ? 'frosted-fade-in' : ''
                          }`} 
                        />
                      ) : (
                        <GenerationPlaceholder />
                      )}
                    </TransformComponent>
                  </TransformWrapper>
                  <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-white/10 bg-[var(--color-accent)] px-2 py-1 text-[10px] font-semibold text-black shadow-[0_0_15px_rgba(var(--color-accent-rgb),0.24)] sm:left-4 sm:top-4 sm:px-2.5 sm:text-xs">
                    Result
                  </div>
                </div>
                </div>
              </div>
            </div>
          )}

          {activeTarget?.status === 'processing' && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/40 backdrop-blur-md">
              <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-pop)]">
                <div className="relative w-16 h-16 mx-auto mb-8">
                    <div className="absolute inset-0 rounded-full border border-[var(--color-accent)]/10"></div>
                    <div className="absolute inset-0 rounded-full border border-[var(--color-accent)] border-t-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <SparklesIcon className="w-5 h-5 text-[var(--color-accent)]" />
                    </div>
                </div>
                
                <h3 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Building your reference edit</h3>
                <p className="mb-10 text-xs text-[var(--color-text-muted)]">Blending background, light, style, and selected elements while preserving the target subject.</p>

                <div className="space-y-4 w-full">
                  {steps.map((step, index) => {
                    let status: 'pending' | 'active' | 'done' = 'pending';
                    if (index < currentStepIndex) {
                      status = 'done';
                    } else if (index === currentStepIndex) {
                      status = 'active';
                    }
                    
                    return <LoadingStep key={step.id} title={step.title} status={status} />;
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
        
        <ImageStrip 
            images={allTargets} 
            activeIndex={activeIndex} 
            onSelect={onSelectIndex} 
            onRemove={onRemoveImage}
            selectedIds={selectedImageIds}
            onToggleSelection={onToggleImageSelection}
        />

        {activeTarget && (
          <div className="mobile-editor-dock no-scrollbar relative z-40 flex min-h-[58px] shrink-0 items-center justify-between gap-2 overflow-x-auto border-t border-[var(--color-border)] bg-[var(--color-header)] px-2 py-2 text-[var(--color-text-muted)] backdrop-blur-xl sm:px-5 md:min-h-[60px]">
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto no-scrollbar py-1">
                <button
                    onClick={() => inputRef.current?.click()}
                    className="btn-secondary flex h-10 items-center gap-2 px-3 py-2 text-xs"
                    aria-label="Upload target images"
                >
                    <PlusIcon className="w-3.5 h-3.5" />
                    <span>Add</span>
                </button>
                <div className="hidden items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1 sm:flex">
                  <button
                    onClick={() => { setViewMode('single'); setActiveImage('target'); }}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${viewMode === 'single' && activeImage === 'target' ? 'bg-[var(--color-accent)] text-black' : 'text-[var(--color-text-muted)] hover:text-white'}`}
                  >
                    Original
                  </button>
                  <button
                    onClick={() => { setViewMode('single'); setActiveImage('generated'); }}
                    disabled={!activeTarget.generated}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${viewMode === 'single' && activeImage === 'generated' ? 'bg-[var(--color-accent)] text-black' : 'text-[var(--color-text-muted)] hover:text-white disabled:opacity-30'}`}
                  >
                    Result
                  </button>
                </div>
            </div>

            <div className="flex min-w-[150px] flex-1 shrink-0 justify-center py-1 lg:hidden">
              {isProcessing ? (
                <button
                  onClick={onCancelGeneration}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-500/15 px-4 text-xs font-extrabold text-red-100 shadow-[0_12px_34px_rgba(0,0,0,0.32)]"
                >
                  <XCircleIcon className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </button>
              ) : (
                <button
                  onClick={onGenerate}
                  disabled={!isActionable}
                  className="primary-cta flex h-10 w-full items-center justify-center gap-2 px-4 text-xs font-extrabold shadow-[0_16px_38px_rgba(var(--color-accent-rgb),0.18)] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <SparklesIcon className="h-3.5 w-3.5" />
                  <span className="truncate">{generateButtonText}</span>
                </button>
              )}
            </div>

            <div className="hidden shrink-0 items-center gap-2 py-1 md:flex">
              <span className="hidden text-xs font-medium text-[var(--color-text-muted)] sm:inline">Zoom {Math.round(zoomLevel * 100)}%</span>
              <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1">
                  <button onClick={handleZoomOut} className="rounded-md p-2 transition-colors hover:bg-[var(--color-surface-hover)] hover:text-white" aria-label="Zoom out"><ZoomOutIcon className="w-3.5 h-3.5" /></button>
                  <button onClick={handleZoomIn} className="rounded-md p-2 transition-colors hover:bg-[var(--color-surface-hover)] hover:text-white" aria-label="Zoom in"><ZoomInIcon className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1">
                  <button onClick={() => setViewMode('side-by-side')} className={`rounded-md p-2 transition-colors ${viewMode === 'side-by-side' ? 'bg-[var(--color-surface-hover)] text-white' : 'hover:text-white'}`} aria-label="Side by side view"><SideBySideViewIcon className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setViewMode('single')} className={`rounded-md p-2 transition-colors ${viewMode === 'single' ? 'bg-[var(--color-surface-hover)] text-white' : 'hover:text-white'}`} aria-label="Single image view"><SingleViewIcon className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 py-1">
              <Tooltip text="Reset view">
                  <button onClick={handleResetTransform} className="btn-secondary hidden h-9 w-9 items-center justify-center p-0 md:flex" aria-label="Reset view">
                    <ResetIcon className="w-3.5 h-3.5" />
                  </button>
              </Tooltip>
              <Tooltip text="Export current image or finished batch.">
                <button
                  onClick={() => setIsDownloadModalOpen(true)}
                  disabled={!activeTarget?.generated && allTargets.filter(t => t.status === 'done').length === 0}
                  className="btn-secondary flex items-center gap-2 px-4 py-2 text-xs disabled:opacity-30"
                >
                  <DownloadIcon className="w-3.5 h-3.5 mr-2" />
                  <span>Export</span>
                </button>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
      {isDownloadModalOpen && createPortal(
        <>
          <div
              className="fixed inset-0 bg-black/80 z-40 transition-opacity duration-300"
              onClick={() => setIsDownloadModalOpen(false)}
              aria-hidden="true"
          />
          <div
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl transition-all duration-300"
              role="dialog"
              aria-modal="true"
              aria-labelledby="download-modal-title"
          >
              <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
                <h2 id="download-modal-title" className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <DownloadIcon className="w-4 h-4 text-[var(--color-accent)]" />
                  Export
                </h2>
                <button onClick={() => setIsDownloadModalOpen(false)} className="p-1 text-[var(--color-text-muted)] hover:text-white transition-colors" aria-label="Close modal">
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                  <div>
                      <label className="mb-3 block text-xs font-semibold text-[var(--color-text-muted)]">File format</label>
                      <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1">
                          <button
                              onClick={() => setExportFormat('jpeg')}
                              className={`rounded-md px-4 py-2 text-center text-xs font-semibold transition-colors ${exportFormat === 'jpeg' ? 'bg-[var(--color-accent)] text-black' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'}`}
                          >JPEG</button>
                          <button
                              onClick={() => setExportFormat('png')}
                              className={`rounded-md px-4 py-2 text-center text-xs font-semibold transition-colors ${exportFormat === 'png' ? 'bg-[var(--color-accent)] text-black' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'}`}
                          >PNG</button>
                      </div>
                  </div>
                  {exportFormat === 'jpeg' && (
                      <div className="pt-2">
                          <div className="flex justify-between items-center mb-2">
                              <label htmlFor="quality-slider" className="text-xs font-semibold text-[var(--color-text-muted)]">Compression quality</label>
                              <span className="text-xs font-semibold text-[var(--color-accent)]">{exportQuality}%</span>
                          </div>
                              <input id="quality-slider" type="range" min="90" max="100" step="1" value={exportQuality} onChange={e => setExportQuality(Number(e.target.value))} className="w-full h-1 bg-[#222222] appearance-none cursor-pointer themed-slider accent-[var(--color-accent)]" />
                      </div>
                  )}
                  <div className="pt-4 space-y-2">
                      <button onClick={handleSingleDownload} disabled={!activeTarget?.generated || isZipping} className="btn-secondary flex w-full items-center justify-center gap-3 px-6 py-3 text-sm disabled:opacity-30">
                          Export current image
                      </button>
                      <button onClick={handleAllDownload} disabled={allTargets.filter(t => t.status === 'done').length === 0 || isZipping} className="primary-cta flex w-full items-center justify-center gap-3 px-6 py-3 text-sm disabled:opacity-30">
                          {isZipping ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : `Export batch (${allTargets.filter(t => t.status === 'done').length})`}
                      </button>
                  </div>
              </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
};
