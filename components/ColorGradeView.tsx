import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Aperture,
  Check,
  ChevronDown,
  Download,
  Eye,
  FileImage,
  History,
  ImagePlus,
  LoaderCircle,
  Redo2,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Undo2,
  Upload,
} from 'lucide-react';
import type {
  ColorGradeOutput,
  ColorGradeDiagnostics,
  ColorGradeProjectState,
  ColorGradeSettings,
  ColorMatchMethod,
  ImageState,
  Project,
} from '../types';
import { Tooltip } from './Tooltip';
import {
  analyzeColorProfile,
  buildAutomaticColorMatchRecipe,
  buildColorGradeLutRecipe,
  canvasToImageState,
  DEFAULT_COLOR_GRADE_SETTINGS,
  renderColorGrade,
  type ColorProfile,
} from '../services/colorGrade';
import { getImageSrc, hasImageSource } from '../services/imageAssets';
import {
  analyzeProjectColorGrade,
  isBrowserProjectStorage,
  renderProjectColorGrade,
  saveProjectAsset,
} from '../services/db';

type CompareMode = 'graded' | 'split' | 'side-by-side' | 'reference';
type InspectorSection = 'match' | 'light' | 'color' | 'wheels' | 'finish' | 'history';

const EMPTY_IMAGE: ImageState = {
  fileName: null,
  base64: null,
  mimeType: null,
  width: null,
  height: null,
  assetPath: null,
  assetUrl: null,
};

const copySettings = (settings: ColorGradeSettings): ColorGradeSettings => ({ ...settings });

async function originalFileToImageState(file: File): Promise<ImageState> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image file could not be read.'));
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The image file could not be decoded.'));
    image.src = dataUrl;
  });
  return {
    fileName: file.name,
    base64: dataUrl.split(',')[1] || null,
    mimeType: file.type || 'image/jpeg',
    width: dimensions.width,
    height: dimensions.height,
    assetPath: null,
    assetUrl: null,
  };
}

const OriginalImageUploader: React.FC<{
  id: string;
  image: ImageState;
  label: string;
  onImage: (image: ImageState) => void | Promise<void>;
}> = ({ id, image, label, onImage }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const source = getImageSrc(image);

  const processFile = async (file: File | undefined) => {
    if (!file || isReading) return;
    setIsReading(true);
    try {
      await onImage(await originalFileToImageState(file));
    } finally {
      setIsReading(false);
    }
  };

  return (
    <div
      className={`group relative aspect-[4/5] w-full overflow-hidden rounded-xl border bg-[var(--color-bg-elevated)] transition-colors ${
        isDragging ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
      }`}
      onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        processFile(event.dataTransfer.files?.[0]);
      }}
    >
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/tiff,image/avif"
        className="hidden"
        onChange={(event) => processFile(event.target.files?.[0])}
      />
      <button type="button" onClick={() => inputRef.current?.click()} className="h-full w-full">
        {source ? (
          <>
            <img src={source} alt={label} className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-[1.02] group-hover:opacity-100" />
            <span className="absolute inset-x-3 bottom-3 rounded-md border border-white/10 bg-black/70 px-2 py-1.5 text-[10px] font-extrabold text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">Replace image</span>
          </>
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-3 text-[var(--color-text-muted)] group-hover:text-white">
            {isReading ? <LoaderCircle className="h-6 w-6 animate-spin text-[var(--color-accent)]" /> : <Upload className="h-7 w-7 opacity-35" />}
            <span className="text-xs font-semibold">{isReading ? 'Reading original...' : label}</span>
          </span>
        )}
      </button>
    </div>
  );
};

function stateFromProject(project: Project | null): ColorGradeProjectState {
  const stored = project?.state?.colorGrade as Partial<ColorGradeProjectState> | undefined;
  return {
    targetImage: stored?.targetImage || EMPTY_IMAGE,
    referenceImage: stored?.referenceImage || EMPTY_IMAGE,
    settings: { ...DEFAULT_COLOR_GRADE_SETTINGS, ...(stored?.settings || {}) },
    outputs: Array.isArray(stored?.outputs) ? stored.outputs : [],
    matchSummary: stored?.matchSummary || null,
    matchAnalyzedAt: stored?.matchAnalyzedAt || null,
    matchDiagnostics: stored?.matchDiagnostics || null,
  };
}

const downloadImage = (image: ImageState, fallbackName: string) => {
  const source = getImageSrc(image);
  if (!source) return;
  const anchor = document.createElement('a');
  anchor.href = source;
  anchor.download = image.fileName || fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

const HistogramScope: React.FC<{ profile: ColorProfile | null }> = ({ profile }) => {
  const maximum = profile ? Math.max(...profile.histogram, 1) : 1;
  const points = profile
    ? profile.histogram.map((value, index) => `${index},${56 - Math.min(54, Math.sqrt(value / maximum) * 54)}`).join(' ')
    : '';

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-black/35 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-extrabold uppercase text-[var(--color-text-muted)]">Luminance scope</span>
        {profile && <span className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: profile.averageColor }} />}
      </div>
      <svg viewBox="0 0 255 58" className="h-16 w-full overflow-visible" preserveAspectRatio="none" aria-label="Graded luminance histogram">
        <defs>
          <linearGradient id="histogram-fill" x1="0" x2="1">
            <stop offset="0%" stopColor="#61D8FF" stopOpacity="0.1" />
            <stop offset="60%" stopColor="#C8FF2F" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#F4B45B" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        {[0, 64, 128, 192, 255].map((x) => <line key={x} x1={x} x2={x} y1="0" y2="58" stroke="rgba(255,255,255,.07)" />)}
        {points && (
          <>
            <polygon points={`0,58 ${points} 255,58`} fill="url(#histogram-fill)" />
            <polyline points={points} fill="none" stroke="#C8FF2F" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
    </div>
  );
};

const SliderControl: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onBegin: () => void;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, suffix = '', onBegin, onChange }) => (
  <label className="block rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-white/[0.06] hover:bg-white/[0.025]">
    <span className="mb-2 flex items-center justify-between gap-3">
      <span className="text-xs font-semibold text-[var(--color-text)]">{label}</span>
      <span className="min-w-[52px] rounded-md border border-[var(--color-border)] bg-black/30 px-2 py-1 text-right font-mono text-[10px] text-[var(--color-text-muted)]">
        {value > 0 && min < 0 ? '+' : ''}{Number.isInteger(step) ? value : value.toFixed(1)}{suffix}
      </span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onPointerDown={onBegin}
      onChange={(event) => onChange(Number(event.target.value))}
      className="themed-slider h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10"
    />
  </label>
);

const InspectorGroup: React.FC<{
  id: InspectorSection;
  title: string;
  icon: React.ReactNode;
  openSection: InspectorSection;
  onOpen: (section: InspectorSection) => void;
  children: React.ReactNode;
}> = ({ id, title, icon, openSection, onOpen, children }) => {
  const isOpen = id === openSection;
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-black/20">
      <button
        type="button"
        onClick={() => onOpen(id)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.035]"
      >
        <span className="text-[var(--color-accent)]">{icon}</span>
        <span className="flex-1 text-xs font-extrabold text-white">{title}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-[var(--color-text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 border-t border-[var(--color-border)] p-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

interface ColorGradeViewProps {
  project: Project | null;
  onUpdateProject: (project: Project) => void | Promise<void>;
  onCreateProject: (name: string, initialState: Project['state']) => Promise<Project | null>;
}

export const ColorGradeView: React.FC<ColorGradeViewProps> = ({ project, onUpdateProject, onCreateProject }) => {
  const initialState = useMemo(() => stateFromProject(project), [project?.id]);
  const [workingProject, setWorkingProject] = useState<Project | null>(project);
  const [targetImage, setTargetImage] = useState(initialState.targetImage);
  const [referenceImage, setReferenceImage] = useState(initialState.referenceImage);
  const [settings, setSettings] = useState(initialState.settings);
  const [outputs, setOutputs] = useState(initialState.outputs);
  const [matchSummary, setMatchSummary] = useState(initialState.matchSummary || null);
  const [matchAnalyzedAt, setMatchAnalyzedAt] = useState(initialState.matchAnalyzedAt || null);
  const [matchDiagnostics, setMatchDiagnostics] = useState<ColorGradeDiagnostics | null>(initialState.matchDiagnostics || null);
  const [compareMode, setCompareMode] = useState<CompareMode>('split');
  const [splitPosition, setSplitPosition] = useState(50);
  const [openSection, setOpenSection] = useState<InspectorSection>('match');
  const [isRendering, setIsRendering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  const [previewProfile, setPreviewProfile] = useState<ColorProfile | null>(null);
  const [referenceProfile, setReferenceProfile] = useState<ColorProfile | null>(null);
  const [status, setStatus] = useState('Add a target and reference to begin.');
  const [undoStack, setUndoStack] = useState<ColorGradeSettings[]>([]);
  const [redoStack, setRedoStack] = useState<ColorGradeSettings[]>([]);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewRunRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const settingGestureRef = useRef(false);
  const targetSource = getImageSrc(targetImage);
  const referenceSource = getImageSrc(referenceImage);
  const canMatch = hasImageSource(targetImage) && hasImageSource(referenceImage);

  useEffect(() => {
    setWorkingProject(project);
    const next = stateFromProject(project);
    setTargetImage(next.targetImage);
    setReferenceImage(next.referenceImage);
    setSettings(next.settings);
    setOutputs(next.outputs);
    setMatchSummary(next.matchSummary || null);
    setMatchAnalyzedAt(next.matchAnalyzedAt || null);
    setMatchDiagnostics(next.matchDiagnostics || null);
  }, [project?.id]);

  const persist = useCallback(async (
    activeProject: Project,
    overrides: Partial<ColorGradeProjectState> = {},
  ) => {
    const updated: Project = {
      ...activeProject,
      lastModified: Date.now(),
      state: {
        ...(activeProject.state || {}),
        colorGrade: {
          targetImage,
          referenceImage,
          settings,
          outputs,
          matchSummary,
          matchAnalyzedAt,
          matchDiagnostics,
          ...overrides,
        },
      },
    };
    setWorkingProject(updated);
    await onUpdateProject(updated);
  }, [onUpdateProject, targetImage, referenceImage, settings, outputs, matchSummary, matchAnalyzedAt, matchDiagnostics]);

  const ensureProject = useCallback(async () => {
    if (workingProject) return workingProject;
    const created = await onCreateProject('Color Grade Session', {
      colorGrade: { targetImage, referenceImage, settings, outputs, matchSummary, matchAnalyzedAt, matchDiagnostics },
    });
    if (created) setWorkingProject(created);
    return created;
  }, [workingProject, onCreateProject, targetImage, referenceImage, settings, outputs, matchSummary, matchAnalyzedAt, matchDiagnostics]);

  const handleImageChange = useCallback(async (kind: 'target' | 'reference', image: ImageState) => {
    const activeProject = await ensureProject();
    if (!activeProject) return;
    setStatus(kind === 'target' ? 'Saving target photo...' : 'Reading reference color...');
    const saved = await saveProjectAsset(activeProject.id, image, kind === 'target' ? 'targets' : 'reference');
    if (kind === 'target') {
      setTargetImage(saved);
      await persist(activeProject, { targetImage: saved });
      setStatus('Target ready. Add a reference or fine-tune manually.');
    } else {
      setReferenceImage(saved);
      setMatchSummary(null);
      setMatchAnalyzedAt(null);
      setMatchDiagnostics(null);
      const profile = await analyzeColorProfile(saved);
      setReferenceProfile(profile);
      await persist(activeProject, { referenceImage: saved, matchSummary: null, matchAnalyzedAt: null, matchDiagnostics: null });
      setStatus('Reference color profile ready.');
    }
  }, [ensureProject, persist]);

  useEffect(() => {
    if (!referenceSource) {
      setReferenceProfile(null);
      return;
    }
    analyzeColorProfile(referenceImage).then(setReferenceProfile).catch(() => setReferenceProfile(null));
  }, [referenceSource]);

  useEffect(() => {
    if (!targetSource) return;
    const runId = ++previewRunRef.current;
    const timer = window.setTimeout(async () => {
      setIsRendering(true);
      try {
        const result = await renderColorGrade(targetImage, referenceSource ? referenceImage : null, settings, 1400);
        if (runId !== previewRunRef.current) return;
        const canvas = previewCanvasRef.current;
        if (!canvas) return;
        canvas.width = result.canvas.width;
        canvas.height = result.canvas.height;
        const context = canvas.getContext('2d');
        context?.drawImage(result.canvas, 0, 0);
        setPreviewProfile(result.profile);
        setStatus(referenceSource ? 'Reference match preview ready.' : 'Manual grade preview ready.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not render the color preview.');
      } finally {
        if (runId === previewRunRef.current) setIsRendering(false);
      }
    }, 70);
    return () => window.clearTimeout(timer);
  }, [targetSource, referenceSource, targetImage, referenceImage, settings]);

  useEffect(() => {
    if (!workingProject) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      persist(workingProject, { settings }).catch(() => setStatus('Project save failed.'));
    }, 650);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [settings]);

  const beginSettingGesture = useCallback(() => {
    if (settingGestureRef.current) return;
    settingGestureRef.current = true;
    setUndoStack((previous) => [...previous.slice(-39), copySettings(settings)]);
    setRedoStack([]);
    window.addEventListener('pointerup', () => {
      settingGestureRef.current = false;
    }, { once: true });
  }, [settings]);

  const changeSetting = useCallback(<Key extends keyof ColorGradeSettings>(key: Key, value: ColorGradeSettings[Key]) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }, []);

  const undo = useCallback(() => {
    setUndoStack((previous) => {
      const snapshot = previous[previous.length - 1];
      if (!snapshot) return previous;
      setRedoStack((redo) => [...redo, copySettings(settings)]);
      setSettings(snapshot);
      return previous.slice(0, -1);
    });
  }, [settings]);

  const redo = useCallback(() => {
    setRedoStack((previous) => {
      const snapshot = previous[previous.length - 1];
      if (!snapshot) return previous;
      setUndoStack((undoHistory) => [...undoHistory, copySettings(settings)]);
      setSettings(snapshot);
      return previous.slice(0, -1);
    });
  }, [settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const resetGrade = () => {
    setUndoStack((previous) => [...previous.slice(-39), copySettings(settings)]);
    setRedoStack([]);
    setSettings(copySettings(DEFAULT_COLOR_GRADE_SETTINGS));
    setMatchSummary(null);
    setMatchAnalyzedAt(null);
    setMatchDiagnostics(null);
  };

  const applyAutomaticReferenceMatch = useCallback(async () => {
    if (!canMatch || isAutoMatching) return;
    setIsAutoMatching(true);
    setStatus('Analyzing local color distributions...');
    try {
      const recipe = await buildAutomaticColorMatchRecipe(targetImage, referenceImage);
      setUndoStack((previous) => [...previous.slice(-39), copySettings(settings)]);
      setRedoStack([]);
      const nextSettings = recipe.settings;
      setSettings(nextSettings);
      setMatchSummary(recipe.summary);
      setMatchDiagnostics(recipe.diagnostics);
      const analyzedAt = Date.now();
      setMatchAnalyzedAt(analyzedAt);
      setCompareMode('split');
      const activeProject = await ensureProject();
      if (activeProject) {
        await persist(activeProject, {
          settings: nextSettings,
          matchSummary: recipe.summary,
          matchAnalyzedAt: analyzedAt,
          matchDiagnostics: recipe.diagnostics,
        });
        await analyzeProjectColorGrade(activeProject.id, targetImage, referenceImage, nextSettings).catch(() => null);
      }
      setStatus(`Power match ready: ${recipe.summary}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Automatic color matching could not be completed.');
    } finally {
      setIsAutoMatching(false);
    }
  }, [canMatch, isAutoMatching, targetImage, referenceImage, settings, ensureProject, persist]);

  const exportGrade = useCallback(async (format: 'png' | 'jpeg', saveToProject: boolean) => {
    if (!hasImageSource(targetImage)) return;
    setIsSaving(true);
    setStatus('Rendering full-resolution color grade...');
    try {
      const activeProject = await ensureProject();
      if (!activeProject) return;
      const baseName = (targetImage.fileName || 'graded-photo').replace(/\.[^.]+$/, '');
      let saved: ImageState;
      if (!isBrowserProjectStorage()) {
        const recipe = await buildColorGradeLutRecipe(
          targetImage,
          referenceSource ? referenceImage : null,
          settings,
          matchDiagnostics,
        );
        const rendered = await renderProjectColorGrade(
          activeProject.id,
          targetImage,
          referenceSource ? referenceImage : null,
          recipe,
          format,
          `${baseName}-master-match`,
        );
        saved = rendered.image;
      } else {
        const result = await renderColorGrade(targetImage, referenceSource ? referenceImage : null, settings);
        const image = canvasToImageState(result.canvas, `${baseName}-color-grade.${format === 'jpeg' ? 'jpg' : 'png'}`, format);
        saved = await saveProjectAsset(activeProject.id, image, 'outputs');
      }
      const output: ColorGradeOutput = {
        id: `grade-${Date.now()}`,
        image: saved,
        createdAt: Date.now(),
        settings: copySettings(settings),
        diagnostics: matchDiagnostics,
      };
      const nextOutputs = [output, ...outputs].slice(0, 60);
      setOutputs(nextOutputs);
      await persist(activeProject, { outputs: nextOutputs, settings });
      if (!saveToProject) downloadImage(saved, saved.fileName || 'ISTUDIO-color-grade.png');
      setStatus(saveToProject ? 'Full-resolution grade saved to project.' : 'Full-resolution grade exported.');
    } catch (error) {
      console.error('Color grade export failed', error);
      setStatus(error instanceof Error ? error.message : 'Color grade export failed.');
    } finally {
      setIsSaving(false);
    }
  }, [targetImage, referenceImage, referenceSource, settings, matchDiagnostics, outputs, ensureProject, persist]);

  const primarySliders: Array<[keyof ColorGradeSettings, string, number, number, number?, string?]> = [
    ['matchStrength', 'Overall match', 0, 100, 1, '%'],
    ['detailProtection', 'Texture protection', 0, 100, 1, '%'],
  ];
  const matchMethods: Array<{ id: ColorMatchMethod; label: string; description: string }> = [
    { id: 'auto', label: 'Auto Master', description: 'Automatically selects the strongest artifact-free strategy' },
    { id: 'natural', label: 'Natural', description: 'Protected photographic match' },
    { id: 'histogram', label: 'Tone', description: 'Light and dark distribution' },
    { id: 'reinhard', label: 'Reinhard 01', description: 'Classic mean and variance color transfer' },
    { id: 'distribution', label: 'Xiao 06', description: 'Correlated color-space transfer' },
    { id: 'hybrid', label: 'Hybrid', description: 'Histogram plus correlated distribution transfer' },
    { id: 'lab', label: 'Monge 07', description: 'Optimal linear transport with source-gradient fidelity' },
    { id: 'pdf', label: 'Pitie PDF', description: 'Iterative multidimensional probability-distribution transfer' },
  ];
  const lightSliders: Array<[keyof ColorGradeSettings, string, number, number, number?, string?]> = [
    ['exposure', 'Exposure', -2, 2, 0.1, ' EV'],
    ['brightness', 'Brightness', -100, 100],
    ['contrast', 'Contrast', -100, 100],
    ['gamma', 'Gamma', -100, 100],
    ['highlights', 'Highlights', -100, 100],
    ['shadows', 'Shadows', -100, 100],
    ['whites', 'Whites', -100, 100],
    ['blacks', 'Blacks', -100, 100],
  ];
  const colorSliders: Array<[keyof ColorGradeSettings, string, number, number]> = [
    ['temperature', 'Temperature', -100, 100],
    ['tint', 'Tint', -100, 100],
    ['vibrance', 'Vibrance', -100, 100],
    ['saturation', 'Saturation', -100, 100],
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid h-full min-h-0 grid-cols-[200px_minmax(0,1fr)_310px] overflow-hidden bg-[var(--color-bg)] xl:grid-cols-[250px_minmax(0,1fr)_360px]">
      <aside className="flex min-h-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
              <Aperture className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2 className="text-sm font-extrabold text-white">Color Grade</h2>
              <p className="mt-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">Local reference color transfer</p>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 custom-scrollbar">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase text-[var(--color-text-muted)]">Photo to grade</span>
              {targetSource && <Check className="h-3.5 w-3.5 text-emerald-400" />}
            </div>
            <OriginalImageUploader
              id="color-grade-target"
              image={targetImage}
              label="Add target photo"
              onImage={(image) => handleImageChange('target', image)}
            />
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase text-[var(--color-text-muted)]">Color reference</span>
              {referenceSource && <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />}
            </div>
            <OriginalImageUploader
              id="color-grade-reference"
              image={referenceImage}
              label="Add reference look"
              onImage={(image) => handleImageChange('reference', image)}
            />
          </section>
          <div className="rounded-xl border border-[var(--color-border)] bg-black/25 p-4">
            <div className="flex items-start gap-3">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-secondary)]" />
              <div>
                <p className="text-xs font-bold text-white">Structure locked</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
                  Only color and luminance values change. Subject, detail, framing, and geometry remain untouched.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-emerald-400/10 bg-emerald-400/[0.035] p-4">
            <p className="text-xs font-bold text-emerald-200">Private local processing</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-muted)]">
              Photos stay on this computer. Perceptual mapping protects highlights, shadows, skin, and saturated colors.
            </p>
          </div>
        </div>
      </aside>

      <main className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-viewport)]">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-header)] px-4">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-black/25 p-1">
            {([
              ['graded', 'Graded'],
              ['split', 'Split'],
              ['side-by-side', 'Compare'],
              ['reference', 'Reference'],
            ] as Array<[CompareMode, string]>).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setCompareMode(mode)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold ${compareMode === mode ? 'bg-white/10 text-white' : 'text-[var(--color-text-muted)] hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip text="Undo grade adjustment">
              <button onClick={undo} disabled={undoStack.length === 0} className="btn-secondary flex h-9 w-9 items-center justify-center p-0 disabled:opacity-25"><Undo2 className="h-3.5 w-3.5" /></button>
            </Tooltip>
            <Tooltip text="Redo grade adjustment">
              <button onClick={redo} disabled={redoStack.length === 0} className="btn-secondary flex h-9 w-9 items-center justify-center p-0 disabled:opacity-25"><Redo2 className="h-3.5 w-3.5" /></button>
            </Tooltip>
            <button onClick={resetGrade} className="btn-secondary flex h-9 items-center gap-2 px-3 text-xs"><RotateCcw className="h-3.5 w-3.5" />Reset</button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden p-6">
          {!targetSource ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-md rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/80 p-10 text-center">
                <ImagePlus className="mx-auto h-9 w-9 text-[var(--color-accent)]" />
                <h3 className="mt-5 text-lg font-extrabold text-white">Add a photo to color grade</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">Then add a reference photo to match its palette, light distribution, contrast, and tonal character.</p>
              </div>
            </div>
          ) : (
            <div className={`grid h-full min-h-0 gap-4 ${compareMode === 'side-by-side' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {compareMode === 'side-by-side' && (
                <div className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-black">
                  <img src={targetSource} alt="Original target" className="max-h-full max-w-full object-contain" />
                  <span className="absolute left-3 top-3 rounded-md border border-white/10 bg-black/70 px-2.5 py-1 text-[10px] font-extrabold text-white">ORIGINAL</span>
                </div>
              )}
              <div className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-black shadow-2xl">
                {compareMode === 'reference' && referenceSource ? (
                  <img src={referenceSource} alt="Color reference" className="max-h-full max-w-full object-contain" />
                ) : (
                  <div className="relative flex h-full w-full items-center justify-center">
                    <canvas ref={previewCanvasRef} className="max-h-full max-w-full object-contain" />
                    {compareMode === 'split' && (
                      <>
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" style={{ clipPath: `inset(0 ${100 - splitPosition}% 0 0)` }}>
                          <img src={targetSource} alt="Original comparison" className="max-h-full max-w-full object-contain" />
                        </div>
                        <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,.65)]" style={{ left: `${splitPosition}%` }} />
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={splitPosition}
                          onChange={(event) => setSplitPosition(Number(event.target.value))}
                          className="absolute inset-x-5 bottom-5 z-20 cursor-ew-resize opacity-0"
                          aria-label="Comparison split"
                        />
                      </>
                    )}
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-md border border-white/10 bg-[var(--color-accent)] px-2.5 py-1 text-[10px] font-extrabold text-black">
                  {compareMode === 'reference' ? 'REFERENCE' : 'COLOR GRADE'}
                </span>
                {isRendering && (
                  <div className="absolute right-3 top-3 flex items-center gap-2 rounded-md border border-white/10 bg-black/70 px-2.5 py-1 text-[10px] font-bold text-white">
                    <LoaderCircle className="h-3 w-3 animate-spin text-[var(--color-accent)]" /> Updating
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex min-h-[64px] shrink-0 items-center justify-between gap-4 border-t border-[var(--color-border)] bg-[var(--color-header)] px-5">
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="truncate text-xs font-bold text-white">{status}</p>
            <p className="mt-1 hidden text-[10px] text-[var(--color-text-muted)] xl:block">
              {targetImage.width && targetImage.height ? `${targetImage.width} x ${targetImage.height} source` : 'Full-resolution export preserves source dimensions'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => exportGrade('png', true)} disabled={!targetSource || isSaving} className="btn-secondary flex items-center gap-2 px-3 py-2.5 text-xs disabled:opacity-30 xl:px-4">
              <Save className="h-3.5 w-3.5" />Save
            </button>
            <button onClick={() => exportGrade('jpeg', false)} disabled={!targetSource || isSaving} className="btn-secondary flex items-center gap-2 px-3 py-2.5 text-xs disabled:opacity-30 xl:px-4">
              <Download className="h-3.5 w-3.5" />JPEG
            </button>
            <button onClick={() => exportGrade('png', false)} disabled={!targetSource || isSaving} className="primary-cta flex items-center gap-2 px-4 py-2.5 text-xs disabled:opacity-30 xl:px-5">
              {isSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              PNG
            </button>
          </div>
        </div>
      </main>

      <aside className="desktop-inspector flex min-h-0 flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-white">Grade Controls</h2>
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Powerful local matching and precise finishing.</p>
            </div>
            <span className={`rounded-md border px-2 py-1 text-[10px] font-extrabold ${canMatch ? 'border-[var(--color-accent)]/20 bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-white/10 bg-white/5 text-[var(--color-text-muted)]'}`}>
              {canMatch ? 'MATCH READY' : 'MANUAL'}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
          <HistogramScope profile={previewProfile} />

          <InspectorGroup id="match" title="Reference Match" icon={<Sparkles className="h-4 w-4" />} openSection={openSection} onOpen={setOpenSection}>
            {!referenceSource && <p className="px-2 py-3 text-[11px] leading-5 text-amber-200/80">Add a reference photo to activate automatic matching.</p>}
            <button
              type="button"
              onClick={applyAutomaticReferenceMatch}
              disabled={!canMatch || isAutoMatching}
              className="primary-cta mb-2 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-xs disabled:opacity-30"
            >
              {isAutoMatching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {isAutoMatching ? 'Building Master Match...' : 'Master Match'}
            </button>
            {matchSummary && (
              <div className="mx-1 mb-3 rounded-lg border border-[var(--color-accent)]/15 bg-[var(--color-accent)]/[0.055] p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                  <p className="text-[10px] font-extrabold uppercase text-[var(--color-accent)]">Local Match Analysis</p>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-white/75">{matchSummary}</p>
                {matchDiagnostics && (
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {[
                      ['Tone', matchDiagnostics.toneScore],
                      ['Color', matchDiagnostics.colorScore],
                      ['Detail', matchDiagnostics.detailScore],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md border border-white/[0.07] bg-black/20 px-2 py-2 text-center">
                        <p className="text-[9px] font-bold text-[var(--color-text-muted)]">{label}</p>
                        <p className="mt-1 text-xs font-black text-white">{value}%</p>
                      </div>
                    ))}
                  </div>
                )}
                {matchAnalyzedAt && <p className="mt-2 text-[9px] text-[var(--color-text-muted)]">Applied {new Date(matchAnalyzedAt).toLocaleString()}</p>}
              </div>
            )}
            {primarySliders.map(([key, label, min, max, step, suffix]) => (
              <SliderControl key={key} label={label} value={settings[key] as number} min={min} max={max} step={step} suffix={suffix} onBegin={beginSettingGesture} onChange={(value) => changeSetting(key, value)} />
            ))}
            <details className="mx-1 mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02]">
              <summary className="cursor-pointer px-3 py-3 text-[10px] font-extrabold uppercase text-[var(--color-text-muted)]">
                Advanced matching
              </summary>
              <div className="border-t border-white/[0.06] p-2">
                <div className="mb-2 grid grid-cols-2 gap-1.5">
                  {matchMethods.map((method) => (
                    <Tooltip key={method.id} text={method.description}>
                      <button
                        type="button"
                        onClick={() => {
                          beginSettingGesture();
                          changeSetting('matchMethod', method.id);
                          if (method.id !== 'auto') changeSetting('autoMethod', method.id);
                          setMatchSummary(null);
                          setMatchAnalyzedAt(null);
                          setMatchDiagnostics(null);
                        }}
                        className={`rounded-lg border px-2.5 py-2 text-[10px] font-extrabold transition-colors ${
                          settings.matchMethod === method.id
                            ? 'border-[var(--color-accent)]/35 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                            : 'border-white/[0.06] bg-white/[0.025] text-[var(--color-text-muted)] hover:text-white'
                        }`}
                      >
                        {method.label}
                      </button>
                    </Tooltip>
                  ))}
                </div>
                {([
                  ['luminanceMatch', 'Light structure'],
                  ['colorMatch', 'Palette match'],
                  ['contrastMatch', 'Contrast match'],
                ] as Array<[keyof ColorGradeSettings, string]>).map(([key, label]) => (
                  <SliderControl
                    key={key}
                    label={label}
                    value={settings[key] as number}
                    min={0}
                    max={100}
                    suffix="%"
                    onBegin={beginSettingGesture}
                    onChange={(value) => changeSetting(key, value)}
                  />
                ))}
              </div>
            </details>
            {referenceProfile && (
              <div className="mx-2 mt-2 flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
                <span className="h-8 w-8 rounded-lg border border-white/10" style={{ background: referenceProfile.averageColor }} />
                <div>
                  <p className="text-[10px] font-extrabold text-white">Reference profile</p>
                  <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">Light, contrast, and chroma sampled locally</p>
                </div>
              </div>
            )}
          </InspectorGroup>

          <InspectorGroup id="light" title="Light & Tone" icon={<SunMedium className="h-4 w-4" />} openSection={openSection} onOpen={setOpenSection}>
            {lightSliders.map(([key, label, min, max, step, suffix]) => (
              <SliderControl key={key} label={label} value={settings[key] as number} min={min} max={max} step={step} suffix={suffix} onBegin={beginSettingGesture} onChange={(value) => changeSetting(key, value)} />
            ))}
          </InspectorGroup>

          <InspectorGroup id="color" title="Color Balance" icon={<SlidersHorizontal className="h-4 w-4" />} openSection={openSection} onOpen={setOpenSection}>
            {colorSliders.map(([key, label, min, max]) => (
              <SliderControl key={key} label={label} value={settings[key] as number} min={min} max={max} onBegin={beginSettingGesture} onChange={(value) => changeSetting(key, value)} />
            ))}
          </InspectorGroup>

          <InspectorGroup id="wheels" title="Three-Way Color" icon={<Aperture className="h-4 w-4" />} openSection={openSection} onOpen={setOpenSection}>
            {([
              ['shadowColor', 'shadowColorStrength', 'Shadows'],
              ['midtoneColor', 'midtoneColorStrength', 'Midtones'],
              ['highlightColor', 'highlightColorStrength', 'Highlights'],
            ] as Array<[keyof ColorGradeSettings, keyof ColorGradeSettings, string]>).map(([colorKey, strengthKey, label]) => (
              <div key={label} className="rounded-lg border border-transparent px-2 py-2 hover:border-white/[0.06] hover:bg-white/[0.025]">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">{label}</span>
                  <input
                    type="color"
                    value={settings[colorKey] as string}
                    onPointerDown={beginSettingGesture}
                    onChange={(event) => changeSetting(colorKey, event.target.value)}
                    className="h-7 w-9 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
                    aria-label={`${label} color`}
                  />
                </div>
                <SliderControl label="Influence" value={settings[strengthKey] as number} min={-100} max={100} onBegin={beginSettingGesture} onChange={(value) => changeSetting(strengthKey, value)} />
              </div>
            ))}
          </InspectorGroup>

          <InspectorGroup id="finish" title="Finish" icon={<FileImage className="h-4 w-4" />} openSection={openSection} onOpen={setOpenSection}>
            <SliderControl label="Clarity" value={settings.clarity} min={-100} max={100} onBegin={beginSettingGesture} onChange={(value) => changeSetting('clarity', value)} />
            <SliderControl label="Sharpness" value={settings.sharpness} min={0} max={100} onBegin={beginSettingGesture} onChange={(value) => changeSetting('sharpness', value)} />
            <SliderControl label="Fade" value={settings.fade} min={0} max={100} onBegin={beginSettingGesture} onChange={(value) => changeSetting('fade', value)} />
            <SliderControl label="Vignette" value={settings.vignette} min={-100} max={100} onBegin={beginSettingGesture} onChange={(value) => changeSetting('vignette', value)} />
            <SliderControl label="Film grain" value={settings.grain} min={0} max={100} onBegin={beginSettingGesture} onChange={(value) => changeSetting('grain', value)} />
          </InspectorGroup>

          {outputs.length > 0 && (
            <InspectorGroup id="history" title={`Saved Grades (${outputs.length})`} icon={<History className="h-4 w-4" />} openSection={openSection} onOpen={setOpenSection}>
              <div className="grid grid-cols-2 gap-2 p-1">
                {outputs.slice(0, 8).map((output) => (
                  <button key={output.id} type="button" onClick={() => downloadImage(output.image, 'ISTUDIO-color-grade.png')} className="group overflow-hidden rounded-lg border border-[var(--color-border)] bg-black/25 text-left hover:border-[var(--color-border-hover)]">
                    <img src={getImageSrc(output.image) || ''} alt="Saved color grade" className="aspect-[4/3] w-full object-cover" />
                    <span className="block truncate px-2 py-2 text-[10px] font-semibold text-[var(--color-text-muted)] group-hover:text-white">
                      {new Date(output.createdAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            </InspectorGroup>
          )}
        </div>
      </aside>
    </motion.div>
  );
};
