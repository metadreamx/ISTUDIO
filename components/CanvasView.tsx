import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Konva from 'konva';
import { Stage, Layer, Group, Rect, Ellipse, Text, Image as KonvaImage, Transformer, Line } from 'react-konva';
import {
  Brush,
  ChevronDown,
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  Hand,
  History,
  ImagePlus,
  Layers,
  Lock,
  Maximize2,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Shapes,
  Sparkles,
  Square,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Unlock,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  CanvasAsset,
  CanvasBrushLayer,
  CanvasDocument,
  CanvasExportFormat,
  CanvasImageFitMode,
  CanvasImageLayer,
  CanvasLayer,
  CanvasPanel,
  CanvasShapeLayer,
  CanvasTemplate,
  CanvasTextLayer,
  CanvasTool,
  ImageState,
  Project,
} from '../types';
import { canvasTemplates } from '../data/canvasTemplates';
import { processAndResizeImage, editImage } from '../services/geminiService';
import { Tooltip } from './Tooltip';

interface CanvasViewProps {
  project: Project | null;
  onUpdateProject: (project: Project) => void;
  onCreateProject: (name: string, initialState: Project['state']) => Promise<Project | null>;
  canCreateProjects: boolean;
}

type HistoryState = {
  past: CanvasDocument[];
  future: CanvasDocument[];
  labels: string[];
};

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cloneLayer = (layer: CanvasLayer): CanvasLayer => ({
  ...layer,
  id: createId(layer.type),
});

const createBlankDocument = (name = 'Untitled Canvas', width = 1080, height = 1080): CanvasDocument => ({
  id: createId('canvas-doc'),
  name,
  width,
  height,
  background: '#F7F7EF',
  layers: [],
  assets: [],
  exports: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const createDocumentFromTemplate = (template: CanvasTemplate): CanvasDocument => ({
  id: createId('canvas-doc'),
  name: template.title,
  width: template.width,
  height: template.height,
  background: template.background,
  layers: template.layers.map(cloneLayer),
  assets: [],
  exports: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const imageStateToDataUrl = (image?: ImageState | null) => {
  if (!image?.base64 || !image.mimeType) return null;
  return `data:${image.mimeType};base64,${image.base64}`;
};

const dataUrlToImageState = (dataUrl: string, fileName: string, width?: number, height?: number): ImageState => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return {
    fileName,
    mimeType: match?.[1] || 'image/png',
    base64: match?.[2] || '',
    width,
    height,
  };
};

const getImageNaturalSize = (image?: ImageState | null) => {
  const width = Number(image?.width) > 0 ? Number(image?.width) : 1080;
  const height = Number(image?.height) > 0 ? Number(image?.height) : 1080;
  return { width, height, ratio: width / height };
};

const fitSizeWithin = (naturalWidth: number, naturalHeight: number, maxWidth: number, maxHeight: number) => {
  const ratio = naturalWidth / naturalHeight || 1;
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return { width: Math.max(24, width), height: Math.max(24, height) };
};

const createImageLayerFromAsset = (asset: CanvasAsset, document: CanvasDocument, index = 0): CanvasImageLayer => {
  const natural = getImageNaturalSize(asset.image);
  const size = fitSizeWithin(natural.width, natural.height, document.width * 0.58, document.height * 0.58);
  return {
    id: createId('image'),
    type: 'image',
    name: asset.name,
    visible: true,
    locked: false,
    opacity: 1,
    x: document.width * 0.16 + index * 24,
    y: document.height * 0.16 + index * 24,
    width: size.width,
    height: size.height,
    rotation: 0,
    source: asset.image,
    fitMode: 'fit',
    crop: null,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    flipX: false,
    flipY: false,
    brightness: 0,
    contrast: 0,
    saturation: 0,
  };
};

const getCoverCrop = (image: HTMLImageElement, frameWidth: number, frameHeight: number) => {
  const imageRatio = image.width / image.height;
  const frameRatio = frameWidth / frameHeight;
  if (imageRatio > frameRatio) {
    const width = image.height * frameRatio;
    return { x: (image.width - width) / 2, y: 0, width, height: image.height };
  }
  const height = image.width / frameRatio;
  return { x: 0, y: (image.height - height) / 2, width: image.width, height };
};

const normalizeImageResize = (layer: CanvasImageLayer, updates: Partial<CanvasImageLayer>): Partial<CanvasImageLayer> => {
  const fitMode = updates.fitMode ?? layer.fitMode ?? 'fit';
  if (fitMode !== 'fit') return updates;
  const naturalWidth = updates.naturalWidth || layer.naturalWidth || layer.source.width || 1080;
  const naturalHeight = updates.naturalHeight || layer.naturalHeight || layer.source.height || 1080;
  const ratio = naturalWidth / naturalHeight || 1;
  if (updates.fitMode === 'fit' && !updates.width && !updates.height) {
    return { ...updates, height: Math.max(24, layer.width / ratio) };
  }
  if (updates.width && !updates.height) return { ...updates, height: Math.max(24, updates.width / ratio) };
  if (updates.height && !updates.width) return { ...updates, width: Math.max(24, updates.height * ratio) };
  if (updates.width && updates.height) {
    const width = Math.max(24, updates.width);
    return { ...updates, width, height: Math.max(24, width / ratio) };
  }
  return updates;
};

const downloadDataUrl = (dataUrl: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const getLayerIcon = (layer: CanvasLayer) => {
  if (layer.type === 'text') return <TypeIcon className="h-3.5 w-3.5" />;
  if (layer.type === 'shape') return layer.shape === 'ellipse' ? <Circle className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />;
  if (layer.type === 'brush' || layer.type === 'mask') return <Brush className="h-3.5 w-3.5" />;
  if (layer.type === 'ai-result') return <Sparkles className="h-3.5 w-3.5" />;
  return <ImagePlus className="h-3.5 w-3.5" />;
};

const useCanvasImage = (source?: ImageState | null) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const dataUrl = imageStateToDataUrl(source);
    if (!dataUrl) {
      setImage(null);
      return;
    }

    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!cancelled) setImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setImage(null);
    };
    img.src = dataUrl;

    return () => {
      cancelled = true;
    };
  }, [source?.base64, source?.mimeType]);

  return image;
};

const CanvasImageNode: React.FC<{
  layer: CanvasImageLayer;
  selected: boolean;
  registerNode: (id: string, node: Konva.Node | null) => void;
  onSelect: () => void;
  onChange: (updates: Partial<CanvasImageLayer>) => void;
}> = ({ layer, selected, registerNode, onSelect, onChange }) => {
  const image = useCanvasImage(layer.source);
  const imageNodeRef = useRef<Konva.Image | null>(null);
  const fitMode = layer.fitMode || 'fit';
  const hasFilters = Boolean(layer.brightness || layer.contrast || layer.saturation);
  const shouldCrop = Boolean(image && (fitMode === 'fill' || fitMode === 'crop'));
  const crop = shouldCrop
    ? (layer.crop && layer.crop.width > 0 && layer.crop.height > 0 ? layer.crop : getCoverCrop(image!, layer.width, layer.height))
    : undefined;
  const displayX = layer.x + (layer.flipX ? layer.width : 0);
  const displayY = layer.y + (layer.flipY ? layer.height : 0);

  useEffect(() => {
    const node = imageNodeRef.current;
    if (!node || !image) return;
    if (hasFilters) {
      node.cache();
    } else {
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [hasFilters, image, layer.brightness, layer.contrast, layer.saturation, layer.width, layer.height, crop?.x, crop?.y, crop?.width, crop?.height]);

  return (
    <KonvaImage
      ref={(node) => {
        imageNodeRef.current = node;
        registerNode(layer.id, node);
      }}
      image={image || undefined}
      x={displayX}
      y={displayY}
      width={layer.width}
      height={layer.height}
      crop={crop}
      filters={hasFilters ? [Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.HSL] : undefined}
      brightness={(layer.brightness || 0) / 100}
      contrast={layer.contrast || 0}
      saturation={(layer.saturation || 0) / 100}
      rotation={layer.rotation}
      opacity={layer.opacity}
      visible={layer.visible}
      draggable={!layer.locked}
      listening={!layer.locked}
      scaleX={layer.flipX ? -1 : 1}
      scaleY={layer.flipY ? -1 : 1}
      shadowColor={selected ? '#C8FF2F' : undefined}
      shadowBlur={selected ? 18 : 0}
      onClick={onSelect}
      onTap={onSelect}
      perfectDrawEnabled={false}
      onDragEnd={(event) => onChange({
        x: event.target.x() - (layer.flipX ? layer.width : 0),
        y: event.target.y() - (layer.flipY ? layer.height : 0),
      })}
      onTransformEnd={(event) => {
        const node = event.target;
        const rawScaleX = Math.abs(node.scaleX());
        const rawScaleY = Math.abs(node.scaleY());
        const nextWidth = Math.max(24, node.width() * rawScaleX);
        const nextHeight = Math.max(24, node.height() * rawScaleY);
        node.scaleX(layer.flipX ? -1 : 1);
        node.scaleY(layer.flipY ? -1 : 1);
        onChange(normalizeImageResize({
          ...layer,
          naturalWidth: image?.width || layer.naturalWidth,
          naturalHeight: image?.height || layer.naturalHeight,
        }, {
          x: node.x() - (layer.flipX ? nextWidth : 0),
          y: node.y() - (layer.flipY ? nextHeight : 0),
          width: nextWidth,
          height: nextHeight,
          naturalWidth: image?.width || layer.naturalWidth,
          naturalHeight: image?.height || layer.naturalHeight,
          rotation: node.rotation(),
        }));
      }}
    />
  );
};

const CanvasLayerNode: React.FC<{
  layer: CanvasLayer;
  selected: boolean;
  registerNode: (id: string, node: Konva.Node | null) => void;
  onSelect: () => void;
  onChange: (updates: Partial<CanvasLayer>) => void;
}> = ({ layer, selected, registerNode, onSelect, onChange }) => {
  if (layer.type === 'image' || layer.type === 'reference' || layer.type === 'ai-result') {
    return (
      <CanvasImageNode
        layer={layer}
        selected={selected}
        registerNode={registerNode}
        onSelect={onSelect}
        onChange={(updates) => onChange(updates)}
      />
    );
  }

  if (layer.type === 'text') {
    return (
      <Text
        ref={(node) => registerNode(layer.id, node)}
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
        rotation={layer.rotation}
        opacity={layer.opacity}
        visible={layer.visible}
        draggable={!layer.locked}
        listening={!layer.locked}
        text={layer.text}
        fontSize={layer.fontSize}
        fontFamily={layer.fontFamily}
        fontStyle={layer.fontStyle}
        fill={layer.fill}
        align={layer.align}
        lineHeight={layer.lineHeight}
        shadowColor={selected ? '#C8FF2F' : undefined}
        shadowBlur={selected ? 14 : 0}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(event) => onChange({ x: event.target.x(), y: event.target.y() })}
        onTransformEnd={(event) => {
          const node = event.target;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            x: node.x(),
            y: node.y(),
            width: Math.max(40, node.width() * scaleX),
            height: Math.max(28, node.height() * scaleY),
            rotation: node.rotation(),
          });
        }}
      />
    );
  }

  if (layer.type === 'shape') {
    const commonProps = {
      ref: (node: Konva.Node | null) => registerNode(layer.id, node),
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      rotation: layer.rotation,
      opacity: layer.opacity,
      visible: layer.visible,
      draggable: !layer.locked,
      listening: !layer.locked,
      fill: layer.fill,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth,
      shadowColor: selected ? '#C8FF2F' : undefined,
      shadowBlur: selected ? 14 : 0,
      onClick: onSelect,
      onTap: onSelect,
      onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => onChange({ x: event.target.x(), y: event.target.y() }),
      onTransformEnd: (event: Konva.KonvaEventObject<Event>) => {
        const node = event.target;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x(),
          y: node.y(),
          width: Math.max(20, node.width() * scaleX),
          height: Math.max(20, node.height() * scaleY),
          rotation: node.rotation(),
        });
      },
    };

    if (layer.shape === 'ellipse') {
      return <Ellipse {...commonProps} radiusX={layer.width / 2} radiusY={layer.height / 2} offsetX={-layer.width / 2} offsetY={-layer.height / 2} />;
    }

    return <Rect {...commonProps} cornerRadius={layer.cornerRadius || 0} />;
  }

  const brushLayer = layer as CanvasBrushLayer;

  return (
    <Line
      ref={(node) => registerNode(brushLayer.id, node)}
      points={brushLayer.points}
      x={brushLayer.x}
      y={brushLayer.y}
      rotation={brushLayer.rotation}
      opacity={brushLayer.opacity}
      visible={brushLayer.visible}
      stroke={brushLayer.stroke}
      strokeWidth={brushLayer.strokeWidth}
      tension={brushLayer.tension}
      lineCap="round"
      lineJoin="round"
      draggable={!brushLayer.locked}
      listening={!brushLayer.locked}
      globalCompositeOperation={brushLayer.tool === 'erase' ? 'destination-out' : 'source-over'}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(event) => onChange({ x: event.target.x(), y: event.target.y() })}
    />
  );
};

const SortableLayerRow: React.FC<{
  layer: CanvasLayer;
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
}> = ({ layer, isSelected, onSelect, onToggleVisibility, onToggleLock }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: layer.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border px-2 py-2 text-left ${
        isSelected
          ? 'border-[var(--color-accent)] bg-[rgba(var(--color-accent-rgb),0.08)]'
          : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-hover)]'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 items-center gap-2 text-left"
        {...attributes}
        {...listeners}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.055] text-[var(--color-accent)]">
          {getLayerIcon(layer)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-[var(--color-text)]">{layer.name}</span>
          <span className="block text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">{layer.type}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onToggleVisibility}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-text)]"
        aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
      >
        {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={onToggleLock}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-text)]"
        aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
      >
        {layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
};

const NumberField: React.FC<{
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, onChange }) => (
  <label className="space-y-1.5">
    <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">{label}</span>
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs text-[var(--color-text)]"
    />
  </label>
);

const StartCanvasScreen: React.FC<{
  canCreateProjects: boolean;
  onStartBlank: (width?: number, height?: number) => void;
  onStartTemplate: (template: CanvasTemplate) => void;
}> = ({ canCreateProjects, onStartBlank, onStartTemplate }) => {
  const presets = [
    ['Square', 1080, 1080],
    ['Portrait', 1080, 1350],
    ['Story', 1080, 1920],
    ['Landscape', 1920, 1080],
  ] as const;

  return (
    <div className="flex h-full min-h-0 overflow-y-auto custom-scrollbar">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-5 sm:p-8">
        <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090A0C] p-6 shadow-[var(--shadow-pop)] sm:p-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_50%_0%,rgba(var(--color-accent-rgb),0.16),transparent_48%)]" />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_460px] lg:items-center">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--color-accent)]">ISTUDIO Canvas</p>
              <h1 className="mt-4 max-w-3xl text-4xl font-black uppercase leading-[0.96] text-[var(--color-text)] sm:text-6xl">
                Design campaign visuals with editable layers.
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)] sm:text-base">
                Build Canva-style layouts inside ISTUDIO: place images, text, shapes, brush marks, templates, and AI-polished result layers without flattening your work.
              </p>
              {!canCreateProjects && (
                <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-200">
                  Project storage is not available. Restart ISTUDIO from the launcher, then create a Canvas design.
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
              <div className="aspect-[4/3] rounded-xl border border-white/10 bg-[var(--color-canvas)] p-5 shadow-2xl">
                <div className="h-full rounded-lg bg-[#F7F7EF] p-5">
                  <div className="h-3 w-28 rounded-full bg-[#111315]" />
                  <div className="mt-8 grid grid-cols-[1fr_0.72fr] gap-5">
                    <div className="rounded-[18px] bg-[#111315] p-5">
                      <div className="h-24 rounded-xl bg-[#C8FF2F]" />
                      <div className="mt-5 h-4 w-36 rounded-full bg-white/80" />
                      <div className="mt-3 h-4 w-24 rounded-full bg-white/35" />
                    </div>
                    <div className="space-y-4">
                      <div className="aspect-square rounded-[18px] bg-[#61D8FF]" />
                      <div className="h-16 rounded-[18px] bg-[#F4B45B]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {presets.map(([label, width, height]) => (
            <button
              key={label}
              type="button"
              onClick={() => onStartBlank(width, height)}
              disabled={!canCreateProjects}
              className="studio-panel-glow rounded-xl premium-panel p-5 text-left disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.055] text-[var(--color-accent)]">
                <Plus className="h-4 w-4" />
              </span>
              <h3 className="mt-5 text-base font-black text-[var(--color-text)]">{label}</h3>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">{width} x {height}px</p>
            </button>
          ))}
        </section>

        <section className="space-y-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--color-accent)]">Templates</p>
            <h2 className="mt-2 text-2xl font-black text-[var(--color-text)]">Start with a professional structure.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {canvasTemplates.map((template, index) => (
              <motion.button
                key={template.id}
                type="button"
                onClick={() => onStartTemplate(template)}
                disabled={!canCreateProjects}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="group studio-panel-glow overflow-hidden rounded-xl premium-panel text-left disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-[var(--color-canvas)] p-4">
                  <div className="h-full w-full rounded-lg" style={{ background: template.background }}>
                    {template.layers.slice(0, 5).map((layer) => (
                      <div
                        key={layer.id}
                        className="absolute rounded-md opacity-90"
                        style={{
                          left: `${(layer.x / template.width) * 100}%`,
                          top: `${(layer.y / template.height) * 100}%`,
                          width: `${(layer.width / template.width) * 100}%`,
                          height: `${(layer.height / template.height) * 100}%`,
                          background: layer.type === 'text' ? 'transparent' : layer.type === 'shape' ? layer.fill : '#23272D',
                          border: layer.type === 'text' ? '0' : '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        {layer.type === 'text' && (
                          <span className="block truncate text-[9px] font-black uppercase leading-none" style={{ color: layer.fill }}>
                            {layer.text}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--color-accent)]">{template.category}</span>
                      <h3 className="mt-2 text-sm font-black text-[var(--color-text)]">{template.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{template.description}</p>
                    </div>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.055] text-[var(--color-accent)] transition-transform group-hover:translate-x-0.5">
                      <ChevronDown className="h-4 w-4 -rotate-90" />
                    </span>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export const CanvasView: React.FC<CanvasViewProps> = ({ project, onUpdateProject, onCreateProject, canCreateProjects }) => {
  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [activePanel, setActivePanel] = useState<CanvasPanel>('layers');
  const [zoom, setZoom] = useState(0.72);
  const [brushColor, setBrushColor] = useState('#C8FF2F');
  const [brushSize, setBrushSize] = useState(14);
  const [draftBrush, setDraftBrush] = useState<CanvasBrushLayer | null>(null);
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [], labels: [] });
  const [exportFormat, setExportFormat] = useState<CanvasExportFormat>('png');
  const [aiPrompt, setAiPrompt] = useState('Unify the full design into a polished campaign visual while preserving the layout, text intent, colors, and subject placement.');
  const [status, setStatus] = useState<string | null>(null);
  const [isAiBusy, setIsAiBusy] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 900, height: 640 });

  const stageRef = useRef<Konva.Stage | null>(null);
  const groupRef = useRef<Konva.Group | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const nodeRefs = useRef<Record<string, Konva.Node | null>>({});
  const saveTimerRef = useRef<number | null>(null);
  const projectRef = useRef<Project | null>(project);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const selectedLayer = useMemo(
    () => document?.layers.find((layer) => layer.id === selectedLayerId) || null,
    [document, selectedLayerId],
  );

  const panelLayers = useMemo(() => [...(document?.layers || [])].reverse(), [document?.layers]);

  const stageOffset = useMemo(() => {
    if (!document) return { x: 0, y: 0 };
    return {
      x: Math.max(24, (stageSize.width - document.width * zoom) / 2),
      y: Math.max(24, (stageSize.height - document.height * zoom) / 2),
    };
  }, [document, stageSize.height, stageSize.width, zoom]);

  const commitDocument = useCallback((updater: CanvasDocument | ((current: CanvasDocument) => CanvasDocument), label = 'Edit') => {
    setDocument((current) => {
      if (!current) return current;
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (!next || next === current) return current;
      const updated = { ...next, updatedAt: Date.now() };
      setHistory((state) => ({
        past: [...state.past.slice(-49), current],
        future: [],
        labels: [...state.labels.slice(-49), label],
      }));
      return updated;
    });
  }, []);

  const replaceDocument = useCallback((next: CanvasDocument | null) => {
    setDocument(next);
    setSelectedLayerId(null);
    setHistory({ past: [], future: [], labels: [] });
    setActivePanel(next ? 'layers' : 'templates');
  }, []);

  useEffect(() => {
    const canvasState = project?.state?.canvas;
    const documents = Array.isArray(canvasState?.documents) ? canvasState.documents as CanvasDocument[] : [];
    const activeDocument = documents.find((item) => item.id === canvasState?.activeDocumentId) || documents[0] || null;
    replaceDocument(activeDocument);
  }, [project?.id, replaceDocument]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    const target = workspaceRef.current;
    if (!target) return;

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setStageSize({
        width: Math.max(320, rect.width),
        height: Math.max(320, rect.height),
      });
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const node = selectedLayerId ? nodeRefs.current[selectedLayerId] : null;
    if (node) {
      transformer.nodes([node]);
      transformer.getLayer()?.batchDraw();
    } else {
      transformer.nodes([]);
    }
  }, [selectedLayerId, document?.layers]);

  useEffect(() => {
    if (!project?.id || !document) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      const currentProject = projectRef.current;
      if (!currentProject) return;
      const existingCanvas = currentProject.state?.canvas;
      const existingDocuments = Array.isArray(existingCanvas?.documents) ? existingCanvas.documents as CanvasDocument[] : [];
      const documents = existingDocuments.some((item) => item.id === document.id)
        ? existingDocuments.map((item) => (item.id === document.id ? document : item))
        : [document, ...existingDocuments];
      const exportImages = document.exports.map((item) => item.dataUrl).filter(Boolean);

      onUpdateProject({
        ...currentProject,
        lastModified: Date.now(),
        generatedImages: Array.from(new Set([...(currentProject.generatedImages || []), ...exportImages])).slice(-24),
        state: {
          ...(currentProject.state || {}),
          canvas: {
            activeDocumentId: document.id,
            documents,
          },
        },
      });
      setStatus('Saved to project folder');
    }, 700);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [document, onUpdateProject, project?.id]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 2200);
    return () => window.clearTimeout(timer);
  }, [status]);

  const fitToScreen = useCallback(() => {
    if (!document) return;
    const nextZoom = Math.min(
      (stageSize.width - 96) / document.width,
      (stageSize.height - 96) / document.height,
      1.25,
    );
    setZoom(Math.max(0.08, nextZoom));
  }, [document, stageSize.height, stageSize.width]);

  useEffect(() => {
    fitToScreen();
  }, [document?.id, fitToScreen]);

  const ensureProjectWithDocument = useCallback(async (nextDocument: CanvasDocument) => {
    if (project) {
      replaceDocument(nextDocument);
      onUpdateProject({
        ...project,
        lastModified: Date.now(),
        state: {
          ...(project.state || {}),
          canvas: {
            activeDocumentId: nextDocument.id,
            documents: [nextDocument, ...((project.state?.canvas?.documents || []) as CanvasDocument[])],
          },
        },
      });
      return project;
    }

    if (!canCreateProjects) {
      setStatus('Project storage is not available. Restart ISTUDIO from the launcher.');
      return null;
    }

    const created = await onCreateProject(`${nextDocument.name} Project`, {
      canvas: {
        activeDocumentId: nextDocument.id,
        documents: [nextDocument],
      },
    });
    if (created) {
      replaceDocument(nextDocument);
    }
    return created;
  }, [canCreateProjects, onCreateProject, onUpdateProject, project, replaceDocument]);

  const startBlank = useCallback((width = 1080, height = 1080) => {
    void ensureProjectWithDocument(createBlankDocument('Untitled Canvas', width, height));
  }, [ensureProjectWithDocument]);

  const startTemplate = useCallback((template: CanvasTemplate) => {
    void ensureProjectWithDocument(createDocumentFromTemplate(template));
  }, [ensureProjectWithDocument]);

  const updateSelectedLayer = useCallback((updates: Partial<CanvasLayer>, label = 'Update layer') => {
    if (!selectedLayerId) return;
    commitDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (layer.id !== selectedLayerId) return layer;
        const nextUpdates = (layer.type === 'image' || layer.type === 'reference' || layer.type === 'ai-result')
          ? normalizeImageResize(layer, updates as Partial<CanvasImageLayer>)
          : updates;
        return { ...layer, ...nextUpdates } as CanvasLayer;
      }),
    }), label);
  }, [commitDocument, selectedLayerId]);

  const updateLayer = useCallback((id: string, updates: Partial<CanvasLayer>, label = 'Update layer') => {
    commitDocument((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (layer.id !== id) return layer;
        const nextUpdates = (layer.type === 'image' || layer.type === 'reference' || layer.type === 'ai-result')
          ? normalizeImageResize(layer, updates as Partial<CanvasImageLayer>)
          : updates;
        return { ...layer, ...nextUpdates } as CanvasLayer;
      }),
    }), label);
  }, [commitDocument]);

  const addLayer = useCallback((layer: CanvasLayer, label = 'Add layer') => {
    commitDocument((current) => ({
      ...current,
      layers: [...current.layers, layer],
    }), label);
    setSelectedLayerId(layer.id);
  }, [commitDocument]);

  const addTextLayer = useCallback(() => {
    if (!document) return;
    addLayer({
      id: createId('text'),
      type: 'text',
      name: 'Headline',
      visible: true,
      locked: false,
      opacity: 1,
      x: document.width * 0.12,
      y: document.height * 0.14,
      width: document.width * 0.52,
      height: 120,
      rotation: 0,
      text: 'Add your headline',
      fontSize: Math.max(34, Math.round(document.width * 0.055)),
      fontFamily: 'Manrope',
      fontStyle: 'bold',
      fill: '#111315',
      align: 'left',
      lineHeight: 1.05,
    }, 'Add text');
    setActiveTool('select');
    setActivePanel('properties');
  }, [addLayer, document]);

  const addShapeLayer = useCallback((shape: 'rect' | 'ellipse' = 'rect') => {
    if (!document) return;
    addLayer({
      id: createId('shape'),
      type: 'shape',
      name: shape === 'ellipse' ? 'Ellipse' : 'Rectangle',
      visible: true,
      locked: false,
      opacity: 1,
      x: document.width * 0.28,
      y: document.height * 0.28,
      width: document.width * 0.32,
      height: document.height * 0.22,
      rotation: 0,
      shape,
      fill: shape === 'ellipse' ? '#61D8FF' : '#C8FF2F',
      stroke: 'rgba(255,255,255,0)',
      strokeWidth: 0,
      cornerRadius: 24,
    }, 'Add shape');
    setActiveTool('select');
    setActivePanel('properties');
  }, [addLayer, document]);

  const handleImageFiles = useCallback(async (files: FileList | File[]) => {
    if (!document) return;
    const items = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (items.length === 0) return;

    setStatus('Preparing images');
    const processed = await Promise.all(items.map(processAndResizeImage));
    const assets: CanvasAsset[] = processed.map((image) => ({
      id: createId('asset'),
      name: image.fileName || 'Image asset',
      image,
      createdAt: Date.now(),
    }));

    commitDocument((current) => {
      const layers: CanvasLayer[] = assets.map((asset, index) => createImageLayerFromAsset(asset, current, index));
      return {
        ...current,
        assets: [...current.assets, ...assets],
        layers: [...current.layers, ...layers],
      };
    }, 'Import image');
    setSelectedLayerId(null);
    setActiveTool('select');
    setActivePanel('layers');
    setStatus('Images added');
  }, [commitDocument, document]);

  const handleFileInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      void handleImageFiles(event.target.files);
    }
    event.target.value = '';
  }, [handleImageFiles]);

  const handleReplaceSelectedImage = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedLayer || !(selectedLayer.type === 'image' || selectedLayer.type === 'reference' || selectedLayer.type === 'ai-result')) return;

    setStatus('Replacing image');
    try {
      const image = await processAndResizeImage(file);
      const natural = getImageNaturalSize(image);
      updateSelectedLayer({
        source: image,
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        fitMode: 'fit',
        crop: null,
      } as Partial<CanvasImageLayer>, 'Replace image');
      setStatus('Image replaced');
    } catch (error) {
      console.error('Image replace failed', error);
      setStatus(error instanceof Error ? error.message : 'Image replace failed');
    }
  }, [selectedLayer, updateSelectedLayer]);

  const alignSelectedLayer = useCallback((position: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (!document || !selectedLayer) return;
    const updates: Partial<CanvasLayer> = {};
    if (position === 'left') updates.x = 0;
    if (position === 'center') updates.x = (document.width - selectedLayer.width) / 2;
    if (position === 'right') updates.x = document.width - selectedLayer.width;
    if (position === 'top') updates.y = 0;
    if (position === 'middle') updates.y = (document.height - selectedLayer.height) / 2;
    if (position === 'bottom') updates.y = document.height - selectedLayer.height;
    updateSelectedLayer(updates, 'Align layer');
  }, [document, selectedLayer, updateSelectedLayer]);

  const deleteSelectedLayer = useCallback(() => {
    if (!selectedLayerId) return;
    commitDocument((current) => ({
      ...current,
      layers: current.layers.filter((layer) => layer.id !== selectedLayerId),
    }), 'Delete layer');
    setSelectedLayerId(null);
  }, [commitDocument, selectedLayerId]);

  const duplicateSelectedLayer = useCallback(() => {
    if (!selectedLayerId) return;
    commitDocument((current) => {
      const index = current.layers.findIndex((layer) => layer.id === selectedLayerId);
      if (index < 0) return current;
      const original = current.layers[index];
      const duplicate = {
        ...original,
        id: createId(original.type),
        name: `${original.name} copy`,
        x: original.x + 32,
        y: original.y + 32,
      } as CanvasLayer;
      const layers = [...current.layers];
      layers.splice(index + 1, 0, duplicate);
      window.setTimeout(() => setSelectedLayerId(duplicate.id), 0);
      return { ...current, layers };
    }, 'Duplicate layer');
  }, [commitDocument, selectedLayerId]);

  const undo = useCallback(() => {
    setHistory((state) => {
      const previous = state.past.at(-1);
      if (!previous || !document) return state;
      setDocument(previous);
      return {
        past: state.past.slice(0, -1),
        future: [document, ...state.future],
        labels: state.labels.slice(0, -1),
      };
    });
  }, [document]);

  const redo = useCallback(() => {
    setHistory((state) => {
      const next = state.future[0];
      if (!next || !document) return state;
      setDocument(next);
      return {
        past: [...state.past, document],
        future: state.future.slice(1),
        labels: [...state.labels, 'Redo'],
      };
    });
  }, [document]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!document) return;
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (isTyping) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelectedLayer();
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedLayer();
      }
      if (selectedLayerId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        const delta = {
          ArrowUp: { y: -amount },
          ArrowDown: { y: amount },
          ArrowLeft: { x: -amount },
          ArrowRight: { x: amount },
        }[event.key]!;
        const layer = document.layers.find((item) => item.id === selectedLayerId);
        if (layer) {
          updateLayer(selectedLayerId, {
            x: layer.x + (delta.x || 0),
            y: layer.y + (delta.y || 0),
          }, 'Nudge layer');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedLayer, document, duplicateSelectedLayer, redo, selectedLayerId, undo, updateLayer]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !document) return;

    const currentPanelLayers = [...document.layers].reverse();
    const oldIndex = currentPanelLayers.findIndex((layer) => layer.id === active.id);
    const newIndex = currentPanelLayers.findIndex((layer) => layer.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reorderedPanelLayers = arrayMove(currentPanelLayers, oldIndex, newIndex);
    commitDocument((current) => ({
      ...current,
      layers: [...reorderedPanelLayers].reverse(),
    }), 'Reorder layers');
  }, [commitDocument, document]);

  const beginBrush = useCallback(() => {
    if (!document || activeTool !== 'brush') return;
    const group = groupRef.current;
    const point = group?.getRelativePointerPosition();
    if (!point) return;

    setDraftBrush({
      id: createId('brush'),
      type: 'brush',
      name: 'Brush stroke',
      visible: true,
      locked: false,
      opacity: 1,
      x: 0,
      y: 0,
      width: document.width,
      height: document.height,
      rotation: 0,
      points: [point.x, point.y],
      stroke: brushColor,
      strokeWidth: brushSize,
      tension: 0.36,
      tool: 'paint',
    });
  }, [activeTool, brushColor, brushSize, document]);

  const updateBrush = useCallback(() => {
    if (!draftBrush || activeTool !== 'brush') return;
    const group = groupRef.current;
    const point = group?.getRelativePointerPosition();
    if (!point) return;
    setDraftBrush((current) => current ? { ...current, points: [...current.points, point.x, point.y] } : current);
  }, [activeTool, draftBrush]);

  const finishBrush = useCallback(() => {
    if (!draftBrush) return;
    if (draftBrush.points.length > 3) {
      addLayer(draftBrush, 'Brush stroke');
    }
    setDraftBrush(null);
  }, [addLayer, draftBrush]);

  const exportCanvas = useCallback((format: CanvasExportFormat = exportFormat) => {
    if (!stageRef.current || !document) return;
    const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const dataUrl = stageRef.current.toDataURL({
      x: stageOffset.x,
      y: stageOffset.y,
      width: document.width * zoom,
      height: document.height * zoom,
      pixelRatio: 1 / zoom,
      mimeType,
      quality: format === 'jpeg' ? 0.92 : 1,
    });
    const exportItem = {
      id: createId('export'),
      name: `${document.name}.${format}`,
      dataUrl,
      format,
      width: document.width,
      height: document.height,
      createdAt: Date.now(),
    };
    commitDocument((current) => ({
      ...current,
      exports: [exportItem, ...current.exports].slice(0, 24),
    }), 'Export');
    downloadDataUrl(dataUrl, exportItem.name);
    setStatus(`Exported ${exportItem.name}`);
    setActivePanel('history');
  }, [commitDocument, document, exportFormat, stageOffset.x, stageOffset.y, zoom]);

  const runAiAssist = useCallback(async (prompt: string) => {
    if (!stageRef.current || !document) return;
    try {
      setIsAiBusy(true);
      setStatus('Sending composite to AI');
      const dataUrl = stageRef.current.toDataURL({
        x: stageOffset.x,
        y: stageOffset.y,
        width: document.width * zoom,
        height: document.height * zoom,
        pixelRatio: 1 / zoom,
        mimeType: 'image/png',
      });
      const imageState = dataUrlToImageState(dataUrl, 'canvas-composite.png', document.width, document.height);
      if (!imageState.base64 || !imageState.mimeType) throw new Error('Could not prepare the canvas composite.');

      const result = await editImage(
        [{ inlineData: { data: imageState.base64, mimeType: imageState.mimeType } }],
        `${prompt}\n\nReturn one polished final image. Preserve the readable text layout and overall design composition.`,
      );

      const aiLayer: CanvasImageLayer = {
        id: createId('ai-result'),
        type: 'ai-result',
        name: 'AI unified result',
        visible: true,
        locked: false,
        opacity: 1,
        x: 0,
        y: 0,
        width: document.width,
        height: document.height,
        rotation: 0,
        source: {
          fileName: `ai-unified-${Date.now()}.png`,
          mimeType: 'image/png',
          base64: result,
          width: document.width,
          height: document.height,
        },
        fitMode: 'fit',
        crop: null,
        naturalWidth: document.width,
        naturalHeight: document.height,
        flipX: false,
        flipY: false,
        brightness: 0,
        contrast: 0,
        saturation: 0,
      };

      addLayer(aiLayer, 'AI assist');
      setActivePanel('layers');
      setStatus('AI result added as a new layer');
    } catch (error) {
      console.error('Canvas AI assist failed', error);
      setStatus(error instanceof Error ? error.message : 'AI assist failed');
    } finally {
      setIsAiBusy(false);
    }
  }, [addLayer, document, stageOffset.x, stageOffset.y, zoom]);

  if (!document) {
    return (
      <StartCanvasScreen
        canCreateProjects={canCreateProjects}
        onStartBlank={startBlank}
        onStartTemplate={startTemplate}
      />
    );
  }

  const tools: { id: CanvasTool; label: string; icon: React.ReactNode; action?: () => void }[] = [
    { id: 'select', label: 'Select', icon: <MousePointer2 className="h-4 w-4" /> },
    { id: 'image', label: 'Add image', icon: <ImagePlus className="h-4 w-4" />, action: () => fileInputRef.current?.click() },
    { id: 'text', label: 'Add text', icon: <TypeIcon className="h-4 w-4" />, action: addTextLayer },
    { id: 'shape', label: 'Add shape', icon: <Shapes className="h-4 w-4" />, action: () => addShapeLayer('rect') },
    { id: 'brush', label: 'Brush', icon: <Brush className="h-4 w-4" /> },
    { id: 'hand', label: 'Hand', icon: <Hand className="h-4 w-4" /> },
  ];

  const panelTabs: { id: CanvasPanel; label: string; icon: React.ReactNode }[] = [
    { id: 'templates', label: 'Templates', icon: <Shapes className="h-4 w-4" /> },
    { id: 'assets', label: 'Assets', icon: <ImagePlus className="h-4 w-4" /> },
    { id: 'layers', label: 'Layers', icon: <Layers className="h-4 w-4" /> },
    { id: 'properties', label: 'Properties', icon: <Wand2 className="h-4 w-4" /> },
    { id: 'ai', label: 'AI Assist', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'history', label: 'History', icon: <History className="h-4 w-4" /> },
  ];
  const selectedImageLayer = selectedLayer && (selectedLayer.type === 'image' || selectedLayer.type === 'reference' || selectedLayer.type === 'ai-result')
    ? selectedLayer
    : null;
  const selectedImageFitMode = selectedImageLayer?.fitMode || 'fit';

  return (
    <div className="grid h-full min-h-0 grid-cols-[64px_1fr] grid-rows-[minmax(0,1fr)_minmax(260px,36vh)] bg-[var(--color-bg)] lg:grid-cols-[64px_1fr_360px] lg:grid-rows-none">
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInput} />
      <input ref={replaceInputRef} type="file" accept="image/*" className="hidden" onChange={handleReplaceSelectedImage} />

      <aside className="flex min-h-0 flex-col items-center gap-2 border-r border-[var(--color-border)] bg-[var(--color-sidebar)] p-3">
        {tools.map((tool) => (
          <Tooltip key={tool.id} text={tool.label}>
            <button
              type="button"
              onClick={() => {
                setActiveTool(tool.id);
                tool.action?.();
              }}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                activeTool === tool.id
                  ? 'border-[var(--color-accent)] bg-[rgba(var(--color-accent-rgb),0.12)] text-[var(--color-accent)]'
                  : 'border-white/10 bg-white/[0.045] text-[var(--color-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-text)]'
              }`}
              aria-label={tool.label}
            >
              {tool.icon}
            </button>
          </Tooltip>
        ))}
      </aside>

      <section className="grid min-w-0 min-h-0 grid-rows-[64px_1fr_58px]">
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-header)] px-4">
          <div className="min-w-0">
            <input
              type="text"
              value={document.name}
              onChange={(event) => commitDocument((current) => ({ ...current, name: event.target.value }), 'Rename document')}
              className="max-w-[360px] border-none bg-transparent px-0 py-1 text-sm font-black text-[var(--color-text)] outline-none"
              aria-label="Canvas document name"
            />
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{document.width} x {document.height}px single-page design</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip text="Undo">
              <button type="button" onClick={undo} disabled={history.past.length === 0} className="btn-secondary flex h-10 w-10 items-center justify-center disabled:opacity-35" aria-label="Undo">
                <Undo2 className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip text="Redo">
              <button type="button" onClick={redo} disabled={history.future.length === 0} className="btn-secondary flex h-10 w-10 items-center justify-center disabled:opacity-35" aria-label="Redo">
                <Redo2 className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip text="Duplicate">
              <button type="button" onClick={duplicateSelectedLayer} disabled={!selectedLayer} className="btn-secondary flex h-10 w-10 items-center justify-center disabled:opacity-35" aria-label="Duplicate selected layer">
                <Copy className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip text="Delete">
              <button type="button" onClick={deleteSelectedLayer} disabled={!selectedLayer} className="btn-secondary flex h-10 w-10 items-center justify-center disabled:opacity-35" aria-label="Delete selected layer">
                <Trash2 className="h-4 w-4" />
              </button>
            </Tooltip>
            <select
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as CanvasExportFormat)}
              className="hidden h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-xs font-semibold text-[var(--color-text)] sm:block"
              aria-label="Export format"
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
            <button type="button" onClick={() => exportCanvas()} className="primary-cta flex h-10 items-center gap-2 px-4 text-sm">
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        <div
          ref={workspaceRef}
          className="relative min-h-0 overflow-hidden bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_42%),#07080A]"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (event.dataTransfer.files.length > 0) void handleImageFiles(event.dataTransfer.files);
          }}
        >
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            onMouseDown={(event) => {
              if (activeTool === 'brush') {
                beginBrush();
                return;
              }
              if (event.target === event.target.getStage()) {
                setSelectedLayerId(null);
              }
            }}
            onMouseMove={updateBrush}
            onMouseUp={finishBrush}
            onTouchStart={(event) => {
              if (activeTool === 'brush') beginBrush();
              if (event.target === event.target.getStage()) setSelectedLayerId(null);
            }}
            onTouchMove={updateBrush}
            onTouchEnd={finishBrush}
          >
            <Layer>
              <Group ref={groupRef} x={stageOffset.x} y={stageOffset.y} scaleX={zoom} scaleY={zoom}>
                <Rect x={0} y={0} width={document.width} height={document.height} fill={document.background} shadowColor="black" shadowOpacity={0.42} shadowBlur={46} shadowOffsetY={22} />
                <Rect x={0} y={0} width={document.width} height={document.height} stroke="rgba(255,255,255,0.22)" strokeWidth={1 / zoom} listening={false} />
                {document.layers.map((layer) => (
                  <CanvasLayerNode
                    key={layer.id}
                    layer={layer}
                    selected={selectedLayerId === layer.id}
                    registerNode={(id, node) => {
                      nodeRefs.current[id] = node;
                    }}
                    onSelect={() => {
                      setSelectedLayerId(layer.id);
                      setActiveTool('select');
                      setActivePanel('properties');
                    }}
                    onChange={(updates) => updateLayer(layer.id, updates, 'Transform layer')}
                  />
                ))}
                {draftBrush && (
                  <Line
                    points={draftBrush.points}
                    stroke={draftBrush.stroke}
                    strokeWidth={draftBrush.strokeWidth}
                    tension={draftBrush.tension}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                )}
                <Transformer
                  ref={transformerRef}
                  rotateEnabled
                  keepRatio={selectedImageLayer ? selectedImageFitMode !== 'stretch' : false}
                  borderStroke="#C8FF2F"
                  anchorStroke="#C8FF2F"
                  anchorFill="#090A0C"
                  anchorSize={10}
                  anchorCornerRadius={4}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 18 || newBox.height < 18) return oldBox;
                    return newBox;
                  }}
                />
              </Group>
            </Layer>
          </Stage>

          <AnimatePresence>
            {status && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="absolute left-1/2 top-4 -translate-x-1/2 rounded-xl border border-white/10 bg-black/72 px-4 py-2 text-xs font-semibold text-[var(--color-text)] shadow-2xl backdrop-blur"
              >
                {status}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-header)] px-4">
          <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span className="hidden sm:inline">{selectedLayer ? selectedLayer.name : 'No layer selected'}</span>
            <span className="rounded-md border border-white/10 bg-white/[0.045] px-2 py-1">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setZoom((value) => Math.max(0.08, value - 0.08))} className="btn-secondary flex h-9 w-9 items-center justify-center" aria-label="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button type="button" onClick={fitToScreen} className="btn-secondary flex h-9 items-center gap-2 px-3 text-xs" aria-label="Fit to screen">
              <Maximize2 className="h-4 w-4" />
              Fit
            </button>
            <button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.08))} className="btn-secondary flex h-9 w-9 items-center justify-center" aria-label="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      <aside className="col-span-2 grid min-h-0 grid-rows-[52px_1fr] border-t border-[var(--color-border)] bg-[var(--color-sidebar)] lg:col-span-1 lg:border-l lg:border-t-0">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-2 no-scrollbar">
          {panelTabs.map((tab) => (
            <Tooltip key={tab.id} text={tab.label}>
              <button
                type="button"
                onClick={() => setActivePanel(tab.id)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  activePanel === tab.id
                    ? 'bg-[rgba(var(--color-accent-rgb),0.12)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-text)]'
                }`}
                aria-label={tab.label}
              >
                {tab.icon}
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="min-h-0 overflow-y-auto p-4 custom-scrollbar">
          {activePanel === 'templates' && (
            <div className="space-y-3">
              <h2 className="text-sm font-black text-[var(--color-text)]">Templates</h2>
              {canvasTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    const next = createDocumentFromTemplate(template);
                    commitDocument(() => next, 'Apply template');
                    setSelectedLayerId(null);
                  }}
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-left hover:border-[var(--color-border-hover)]"
                >
                  <span className="text-xs font-black text-[var(--color-text)]">{template.title}</span>
                  <span className="mt-1 block text-[11px] leading-5 text-[var(--color-text-muted)]">{template.description}</span>
                </button>
              ))}
            </div>
          )}

          {activePanel === 'assets' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-black text-[var(--color-text)]">Assets</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">Drop files onto the workspace or import images here.</p>
              </div>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="primary-cta flex w-full items-center justify-center gap-2 py-3 text-sm">
                <Upload className="h-4 w-4" />
                Import images
              </button>
              <div className="grid grid-cols-2 gap-2">
                {document.assets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      addLayer(createImageLayerFromAsset(asset, document), 'Place asset');
                    }}
                    className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-left hover:border-[var(--color-border-hover)]"
                  >
                    {imageStateToDataUrl(asset.image) ? (
                      <img src={imageStateToDataUrl(asset.image)!} alt="" className="aspect-square w-full object-cover" />
                    ) : (
                      <div className="flex aspect-square items-center justify-center text-[var(--color-text-muted)]">
                        <ImagePlus className="h-5 w-5" />
                      </div>
                    )}
                    <span className="block truncate px-2 py-2 text-[10px] text-[var(--color-text-muted)]">{asset.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activePanel === 'layers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-black text-[var(--color-text)]">Layers</h2>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{document.layers.length} editable layer{document.layers.length === 1 ? '' : 's'}</p>
                </div>
                <button type="button" onClick={addTextLayer} className="btn-secondary flex h-9 w-9 items-center justify-center" aria-label="Add text layer">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {document.layers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center">
                  <Layers className="mx-auto mb-3 h-6 w-6 text-[var(--color-text-muted)] opacity-40" />
                  <p className="text-xs leading-5 text-[var(--color-text-muted)]">Import an image, add text, or choose a shape to begin.</p>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={panelLayers.map((layer) => layer.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {panelLayers.map((layer) => (
                        <SortableLayerRow
                          key={layer.id}
                          layer={layer}
                          isSelected={selectedLayerId === layer.id}
                          onSelect={() => {
                            setSelectedLayerId(layer.id);
                            setActivePanel('properties');
                          }}
                          onToggleVisibility={() => updateLayer(layer.id, { visible: !layer.visible }, 'Toggle visibility')}
                          onToggleLock={() => updateLayer(layer.id, { locked: !layer.locked }, 'Toggle lock')}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          )}

          {activePanel === 'properties' && (
            <div className="space-y-5">
              <h2 className="text-sm font-black text-[var(--color-text)]">Properties</h2>
              {!selectedLayer ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center">
                  <MousePointer2 className="mx-auto mb-3 h-6 w-6 text-[var(--color-text-muted)] opacity-40" />
                  <p className="text-xs leading-5 text-[var(--color-text-muted)]">Select a layer to edit position, color, opacity, and text.</p>
                </div>
              ) : (
                <>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">Layer name</span>
                    <input type="text" value={selectedLayer.name} onChange={(event) => updateSelectedLayer({ name: event.target.value }, 'Rename layer')} className="w-full px-3 py-2 text-xs" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField label="X" value={selectedLayer.x} onChange={(value) => updateSelectedLayer({ x: value }, 'Move layer')} />
                    <NumberField label="Y" value={selectedLayer.y} onChange={(value) => updateSelectedLayer({ y: value }, 'Move layer')} />
                    <NumberField label="Width" value={selectedLayer.width} min={1} onChange={(value) => updateSelectedLayer({ width: Math.max(1, value) }, 'Resize layer')} />
                    <NumberField label="Height" value={selectedLayer.height} min={1} onChange={(value) => updateSelectedLayer({ height: Math.max(1, value) }, 'Resize layer')} />
                    <NumberField label="Rotate" value={selectedLayer.rotation} onChange={(value) => updateSelectedLayer({ rotation: value }, 'Rotate layer')} />
                    <NumberField label="Opacity" value={Math.round(selectedLayer.opacity * 100)} min={0} max={100} onChange={(value) => updateSelectedLayer({ opacity: Math.min(1, Math.max(0, value / 100)) }, 'Opacity')} />
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-4">
                    <button type="button" onClick={() => alignSelectedLayer('left')} className="btn-secondary py-2 text-[11px]">Left</button>
                    <button type="button" onClick={() => alignSelectedLayer('center')} className="btn-secondary py-2 text-[11px]">Center</button>
                    <button type="button" onClick={() => alignSelectedLayer('right')} className="btn-secondary py-2 text-[11px]">Right</button>
                    <button type="button" onClick={() => alignSelectedLayer('top')} className="btn-secondary py-2 text-[11px]">Top</button>
                    <button type="button" onClick={() => alignSelectedLayer('middle')} className="btn-secondary py-2 text-[11px]">Middle</button>
                    <button type="button" onClick={() => alignSelectedLayer('bottom')} className="btn-secondary py-2 text-[11px]">Bottom</button>
                  </div>

                  {selectedImageLayer && (
                    <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-xs font-black text-[var(--color-text)]">Image frame</h3>
                          <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">Fit and crop modes preserve image proportions. Stretch is explicit.</p>
                        </div>
                        <button type="button" onClick={() => replaceInputRef.current?.click()} className="btn-secondary shrink-0 px-3 py-2 text-[11px]">
                          Replace
                        </button>
                      </div>
                      <label className="space-y-1.5">
                        <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">Fit mode</span>
                        <select
                          value={selectedImageFitMode}
                          onChange={(event) => updateSelectedLayer({
                            fitMode: event.target.value as CanvasImageFitMode,
                            crop: null,
                          } as Partial<CanvasImageLayer>, 'Image fit mode')}
                          className="h-10 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-xs font-semibold text-[var(--color-text)]"
                        >
                          <option value="fit">Fit - keep full image</option>
                          <option value="fill">Fill - crop to frame</option>
                          <option value="crop">Crop - centered crop</option>
                          <option value="stretch">Stretch - free transform</option>
                        </select>
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button type="button" onClick={() => updateSelectedLayer({ crop: null } as Partial<CanvasImageLayer>, 'Reset crop')} className="btn-secondary py-2 text-[11px]">
                          Reset crop
                        </button>
                        <button type="button" onClick={() => updateSelectedLayer({ flipX: !selectedImageLayer.flipX } as Partial<CanvasImageLayer>, 'Flip horizontal')} className="btn-secondary py-2 text-[11px]">
                          Flip X
                        </button>
                        <button type="button" onClick={() => updateSelectedLayer({ flipY: !selectedImageLayer.flipY } as Partial<CanvasImageLayer>, 'Flip vertical')} className="btn-secondary py-2 text-[11px]">
                          Flip Y
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <NumberField label="Bright" value={selectedImageLayer.brightness || 0} min={-100} max={100} onChange={(value) => updateSelectedLayer({ brightness: value } as Partial<CanvasImageLayer>, 'Image brightness')} />
                        <NumberField label="Contrast" value={selectedImageLayer.contrast || 0} min={-100} max={100} onChange={(value) => updateSelectedLayer({ contrast: value } as Partial<CanvasImageLayer>, 'Image contrast')} />
                        <NumberField label="Saturation" value={selectedImageLayer.saturation || 0} min={-100} max={100} onChange={(value) => updateSelectedLayer({ saturation: value } as Partial<CanvasImageLayer>, 'Image saturation')} />
                      </div>
                    </div>
                  )}

                  {selectedLayer.type === 'text' && (
                    <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                      <label className="space-y-1.5">
                        <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">Text</span>
                        <textarea value={selectedLayer.text} onChange={(event) => updateSelectedLayer({ text: event.target.value } as Partial<CanvasTextLayer>, 'Edit text')} rows={4} className="w-full px-3 py-2 text-xs" />
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <NumberField label="Font size" value={selectedLayer.fontSize} min={6} onChange={(value) => updateSelectedLayer({ fontSize: value } as Partial<CanvasTextLayer>, 'Font size')} />
                        <label className="space-y-1.5">
                          <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">Color</span>
                          <input type="color" value={selectedLayer.fill} onChange={(event) => updateSelectedLayer({ fill: event.target.value } as Partial<CanvasTextLayer>, 'Text color')} className="h-10 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1" />
                        </label>
                      </div>
                    </div>
                  )}

                  {selectedLayer.type === 'shape' && (
                    <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1.5">
                          <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">Fill</span>
                          <input type="color" value={selectedLayer.fill.startsWith('#') ? selectedLayer.fill : '#C8FF2F'} onChange={(event) => updateSelectedLayer({ fill: event.target.value } as Partial<CanvasShapeLayer>, 'Shape fill')} className="h-10 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1" />
                        </label>
                        <NumberField label="Stroke" value={selectedLayer.strokeWidth} min={0} onChange={(value) => updateSelectedLayer({ strokeWidth: value } as Partial<CanvasShapeLayer>, 'Stroke width')} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activePanel === 'ai' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-black text-[var(--color-text)]">AI Assist</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">AI creates a new image layer from the current composite. Your editable layers stay intact.</p>
              </div>
              <div className="grid gap-2">
                {[
                  ['Unify design', 'Unify this layout into a polished, cohesive campaign visual with professional lighting, clean edges, and premium color harmony.'],
                  ['Clean cutout edges', 'Clean image edges, improve compositing realism, remove halos, and keep the layout unchanged.'],
                  ['Generate variations', 'Create a refined alternate version with the same layout, stronger visual rhythm, and professional campaign finish.'],
                ].map(([label, prompt]) => (
                  <button key={label} type="button" onClick={() => void runAiAssist(prompt)} disabled={isAiBusy} className="btn-secondary flex items-center justify-between gap-3 px-3 py-3 text-left text-xs disabled:opacity-40">
                    <span>{label}</span>
                    <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                  </button>
                ))}
              </div>
              <label className="space-y-1.5">
                <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">Custom instruction</span>
                <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} rows={6} className="w-full px-3 py-2 text-xs" />
              </label>
              <button type="button" onClick={() => void runAiAssist(aiPrompt)} disabled={isAiBusy || !aiPrompt.trim()} className="primary-cta flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-40">
                {isAiBusy ? <RotateCcw className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Apply as new layer
              </button>
            </div>
          )}

          {activePanel === 'history' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-black text-[var(--color-text)]">History and Exports</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">Undo states stay in the session. Exports save into the project folder.</p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                  <span>Undo stack</span>
                  <span>{history.past.length}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={undo} disabled={history.past.length === 0} className="btn-secondary flex-1 py-2 text-xs disabled:opacity-35">Undo</button>
                  <button type="button" onClick={redo} disabled={history.future.length === 0} className="btn-secondary flex-1 py-2 text-xs disabled:opacity-35">Redo</button>
                </div>
              </div>
              <div className="space-y-2">
                {document.exports.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center">
                    <Download className="mx-auto mb-3 h-6 w-6 text-[var(--color-text-muted)] opacity-40" />
                    <p className="text-xs leading-5 text-[var(--color-text-muted)]">No exports yet.</p>
                  </div>
                ) : (
                  document.exports.map((item) => (
                    <button key={item.id} type="button" onClick={() => downloadDataUrl(item.dataUrl, item.name)} className="grid w-full grid-cols-[64px_1fr_auto] items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2 text-left hover:border-[var(--color-border-hover)]">
                      <img src={item.dataUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-[var(--color-text)]">{item.name}</span>
                        <span className="mt-1 block text-[10px] text-[var(--color-text-muted)]">{new Date(item.createdAt).toLocaleString()}</span>
                      </span>
                      <Download className="h-4 w-4 text-[var(--color-accent)]" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
