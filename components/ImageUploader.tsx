import React, { useCallback, useRef, useState } from 'react';
import type { ImageState } from '../types';
import { UploadIcon, SpinnerIcon } from '@/components/icons';
import { processAndResizeImage } from '../services/geminiService';
import { getImageSrc, hasImageSource } from '../services/imageAssets';

interface ImageUploaderProps {
  id: string;
  title: string;
  subtitle: string;
  image: ImageState;
  onImageSelect: (state: ImageState) => void | Promise<void>;
  dominantColor?: string | null;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ id, title, subtitle, image, onImageSelect, dominantColor, compact = false, disabled = false, className = '' }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const imageSrc = getImageSrc(image);
  const hasImage = hasImageSource(image);

  const processFile = useCallback(async (file: File) => {
    if (!file || isProcessing) return;
    
    setIsProcessing(true);
    
    try {
      const imageState = await processAndResizeImage(file);
      await onImageSelect(imageState);
    } catch (error) {
      console.error("Error processing file:", error);
      alert(error instanceof Error ? error.message : "An unknown error occurred during file processing.");
    } finally {
      setIsProcessing(false);
    }
  }, [onImageSelect, isProcessing]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  const handleContainerClick = () => {
    if (disabled || isProcessing) return;
    inputRef.current?.click();
  };

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);
  
  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || isProcessing) return;
    setIsDragging(true);
  }, [disabled, isProcessing]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || isProcessing) return;
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile, disabled, isProcessing]);
  
  // Dynamic styles - simplified for professional look
  const glowStyle: React.CSSProperties = (hasImage && dominantColor) ? {
    borderColor: dominantColor + '80'
  } : {};

  if (compact) {
    return (
      <div 
        className={`h-full w-full ${disabled || isProcessing ? 'cursor-not-allowed opacity-60' : ''} ${className}`}
        title={title || "Reference Image"}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
         <div
            className={`group relative flex h-full w-full items-center justify-center overflow-hidden rounded-md border transition-all duration-300 ${disabled || isProcessing ? '' : 'cursor-pointer'} ${itemCheckedStyle(hasImage, isDragging)} ${isDragging ? 'opacity-100' : ''}`}
            onClick={handleContainerClick}
            style={hasImage ? glowStyle : {}}
        >
            <input
                id={id}
                ref={inputRef}
                type="file"
                accept="image/png, image/jpeg, image/webp"
                className="hidden"
                onChange={handleFileChange}
                disabled={disabled || isProcessing}
            />
            {isProcessing ? (
                <div className="flex items-center justify-center">
                    <SpinnerIcon className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                </div>
            ) : imageSrc ? (
                <img
                    src={imageSrc}
                    alt={title}
                    className="h-full w-full object-cover opacity-85 transition-all duration-500 group-hover:opacity-100"
                />
            ) : (
                <div className="flex flex-col items-center text-[var(--color-text-muted)] group-hover:text-white transition-colors duration-300">
                    <UploadIcon className="w-4 h-4" />
                </div>
            )}
        </div>
      </div>
    );
  }

  function itemCheckedStyle(checked: boolean, dragging: boolean) {
  if (dragging) return 'border-[var(--color-accent)] bg-[var(--color-accent)]/10';
      if (checked) return 'border-[var(--color-accent)]/50 bg-[var(--color-surface)]';
      return 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-hover)]';
  }

  return (
    <div className={`w-full ${disabled ? 'opacity-60' : ''} ${className}`}>
      <div className="flex justify-between items-baseline mb-3 px-1">
          {title && <h3 className="text-xs font-semibold text-[var(--color-text-muted)]">{title}</h3>}
      </div>
      <div 
        className={`group relative aspect-square w-full overflow-hidden rounded-xl border transition-all duration-300 ${disabled || isProcessing ? 'cursor-not-allowed grayscale' : 'cursor-pointer'} ${itemCheckedStyle(hasImage, isDragging)}`}
        onClick={handleContainerClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={hasImage ? glowStyle : {}}
      >
        <input
          id={id}
          ref={inputRef}
          type="file"
          accept="image/png, image/jpeg, image/webp"
          className="hidden"
          onChange={handleFileChange}
          disabled={disabled || isProcessing}
        />
        
        {isProcessing && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/95">
                <div className="w-10 h-10 border-2 border-[var(--color-accent)]/20 border-t-[var(--color-accent)] rounded-full animate-spin"></div>
                <p className="mt-4 text-xs font-semibold text-white">Analyzing image</p>
            </div>
        )}

        {imageSrc ? (
          <>
            <img
                src={imageSrc}
                alt={title}
                className="h-full w-full object-cover opacity-90 transition-transform duration-700 group-hover:scale-105 group-hover:opacity-100"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                <span className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-black">Replace image</span>
            </div>
          </>
        ) : (
          <div className={`flex flex-col h-full w-full items-center justify-center text-[var(--color-text-muted)] transition-all duration-500 ${isDragging ? 'text-[var(--color-accent)] scale-105' : 'group-hover:text-white'}`}>
            <UploadIcon className="mb-3 h-8 w-8 opacity-30 transition-opacity group-hover:opacity-100" />
            <span className="text-xs font-semibold">{isDragging ? 'Drop image' : subtitle || 'Upload image'}</span>
          </div>
        )}
      </div>
    </div>
  );
};
