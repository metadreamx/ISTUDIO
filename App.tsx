
import React, { Suspense, lazy, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import type { AppView, ImageState, ImageTransferState, Project, ProjectStorageMode, ReferenceTemplate } from './types';
import { exportProjectBackup, getProject, getProjects, importProjectBackup, saveProject, deleteProject as dbDeleteProject, getProjectStorageInfo, openProjectsFolder, type ProjectStorageInfo } from './services/db';
import { Logo, SpinnerIcon } from '@/components/icons';
import { Tooltip } from '@/components/Tooltip';
import { ApiKeyModal } from '@/components/ApiKeyModal';
import { 
  LayoutDashboardIcon, 
  PaletteIcon, 
  BoxIcon,
  SettingsIcon, 
  HelpCircleIcon,
  XIcon,
  CheckCircle2Icon,
  SparklesIcon,
  ImagesIcon
} from 'lucide-react';

const DashboardView = lazy(() => import('@/components/DashboardView').then((module) => ({ default: module.DashboardView })));
const StyleTransferView = lazy(() => import('@/components/StyleTransferView').then((module) => ({ default: module.StyleTransferView })));
const VirtualSetView = lazy(() => import('@/components/VirtualSetView').then((module) => ({ default: module.VirtualSetView })));

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const NavButton: React.FC<{
  view: AppView, 
  label: string, 
  icon: React.ReactNode, 
  activeView: AppView, 
  onNavigate: (view: AppView) => void,
  badge?: string
}> = ({ view, label, icon, activeView, onNavigate, badge }) => {
  const isActive = activeView === view;
  return (
      <button
          onClick={() => onNavigate(view)}
          className={`studio-nav-pill relative inline-flex h-10 shrink-0 items-center gap-2 px-3.5 text-sm font-extrabold ${
              isActive ? 'studio-nav-pill-active' : 'text-[var(--color-text-muted)] hover:bg-white/[0.055] hover:text-[var(--color-text)]'
          }`}
          aria-label={label}
      >
          <span className={isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}>{icon}</span>
          <span>{label}</span>
          {badge && (
            <span className="ml-1 rounded-[6px] bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-black uppercase leading-none text-black">
              {badge}
            </span>
          )}
          {isActive && (
              <motion.span
                  layoutId="top-nav-indicator"
                  className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_16px_rgba(var(--color-accent-rgb),0.65)]"
              />
          )}
      </button>
  );
};

const withStartupFallback = async <T,>(promise: Promise<T>, fallback: T, label: string, timeoutMs = 3500): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((resolve) => {
    timeoutId = window.setTimeout(() => {
      console.warn(`${label} startup load timed out; continuing with fallback.`);
      resolve(fallback);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      promise.catch((error) => {
        console.warn(`${label} startup load failed; continuing with fallback.`, error);
        return fallback;
      }),
      timeout,
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

const loadReferenceTemplateImage = async (template: ReferenceTemplate): Promise<ImageState> => {
  const response = await fetch(template.url);
  if (!response.ok) {
    throw new Error(`Could not load ${template.title}.`);
  }

  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${template.title}.`));
    reader.readAsDataURL(blob);
  });
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match?.[2]) {
    throw new Error(`Could not prepare ${template.title}.`);
  }

  return {
    fileName: template.fileName,
    mimeType: match?.[1] || blob.type || 'image/webp',
    base64: match[2],
  };
};

const getProjectGenerationCount = (projectList: Project[]): number => {
  return projectList.reduce((count, project) => {
    const projectHistory = Array.isArray(project.state?.generationHistory)
      ? project.state.generationHistory.length
      : 0;
    const generatedImages = Array.isArray(project.generatedImages)
      ? project.generatedImages.length
      : 0;
    return count + Math.max(projectHistory, generatedImages);
  }, 0);
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const InfoPanel: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  projectCount: number;
  historyCount: number;
  hasApiKey: boolean;
  storageInfo: ProjectStorageInfo | null;
}> = ({ isOpen, onClose, projectCount, historyCount, hasApiKey, storageInfo }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        className="relative w-full max-w-lg rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">ISTUDIO System</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
              Local project storage, AI connection, and project-backed generation history.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            aria-label="Close system info"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['AI connection', hasApiKey ? 'Ready' : 'Required'],
            ['DNA edits', String(projectCount)],
            ['Generations saved', String(historyCount)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
              <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
              <p className="mt-2 text-lg font-semibold text-[var(--color-text)]">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
          <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p className="text-sm leading-6 text-[var(--color-text-muted)]">
            {storageInfo?.mode === 'browser'
              ? 'ISTUDIO stores reference DNA, target photos, generated edits, and outputs in this browser. Export project backups before clearing Safari data or switching devices.'
              : 'ISTUDIO stores reference DNA, target photos, generated edits, and outputs as editable files in the local projects folder.'}
          </p>
          {storageInfo && (
            <p className="mt-2 break-all text-xs leading-5 text-[var(--color-text-muted)]">
              {storageInfo.path}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const App: React.FC = () => {
  // App State
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [toast, setToast] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [projectStorageInfo, setProjectStorageInfo] = useState<ProjectStorageInfo | null>(null);
  const [pendingReferenceTemplate, setPendingReferenceTemplate] = useState<ImageState | null>(null);
  const storageMode: ProjectStorageMode = projectStorageInfo?.mode || 'folder';

  // Shared State for Inter-View Communication
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [imageTransfer, setImageTransfer] = useState<ImageTransferState | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isBusy, setIsBusy] = useState(false);

  const handleSaveApiKey = (key: string) => {
    // WARNING: Storing API keys in localStorage is insecure for production applications. 
    // This is implemented as a client-side prototype for demonstration purposes.
    localStorage.setItem('user_api_key', key);
    setHasApiKey(true);
    setToast('API key saved');
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        setHasApiKey(Boolean(localStorage.getItem('user_api_key') || process.env.GEMINI_API_KEY));
      }
    };
    checkApiKey();
  }, []);

  const handleOpenSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    } else {
      setIsApiKeyModalOpen(true);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [dbProjects, storageInfo] = await Promise.all([
          withStartupFallback(getProjects(), [] as Project[], 'Projects'),
          withStartupFallback(getProjectStorageInfo(), null as ProjectStorageInfo | null, 'Project storage'),
        ]);
        setProjects(dbProjects);
        setProjectStorageInfo(storageInfo);
        if (!storageInfo) {
          setToast("Project storage server is not running. Restart ISTUDIO with LAUNCH.bat.");
        } else if (storageInfo.mode === 'browser') {
          setToast("iPhone PWA mode: projects save in browser storage. Export backups to move them.");
        }
      } catch (e) {
        console.error("Failed to load project folder data", e);
        setToast("Project storage server is not running. Restart ISTUDIO with LAUNCH.bat.");
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const handleNavigate = (view: AppView) => {
    setActiveView(view);
  };

  const createProject = useCallback(async (name: string, nextView: AppView = 'style-transfer', initialState: Project['state'] = {}): Promise<Project | null> => {
    if (!projectStorageInfo) {
      setToast("Project storage server is not running. Restart ISTUDIO with LAUNCH.bat.");
      return null;
    }
    const newProject: Project = {
      id: Date.now().toString(),
      name,
      createdAt: Date.now(),
      lastModified: Date.now(),
      state: initialState,
      generatedImages: [] // Added this
    };
    
    try {
      await saveProject(newProject);
      setProjects(prev => [newProject, ...prev]);
      setProjectStorageInfo(await getProjectStorageInfo());
      setCurrentProject(newProject);
      setActiveView(nextView);
      return newProject;
    } catch (err) {
      console.error("Failed to save project to folder", err);
      setToast("Failed to create project");
      return null;
    }
  }, [projectStorageInfo]);

  const handleCreateProject = async (name: string) => {
    await createProject(name, 'style-transfer');
  };

  const handleSelectReferenceTemplate = useCallback(async (template: ReferenceTemplate) => {
    try {
      setToast(`Loading ${template.title}`);
      const referenceImage = await loadReferenceTemplateImage(template);

      if (projectStorageInfo) {
        const project = await createProject(
          `${template.title} Reference Edit`,
          'style-transfer',
          {
            referenceImage,
            referenceTemplateId: template.id,
          },
        );
        if (project) {
          setToast(`${template.title} loaded as the reference`);
        }
        return;
      }

      setPendingReferenceTemplate(referenceImage);
      setCurrentProject(null);
      setActiveView('style-transfer');
      setToast(`${template.title} loaded as the reference`);
    } catch (error) {
      console.error('Failed to load reference template', error);
      setToast(error instanceof Error ? error.message : 'Failed to load reference template');
    }
  }, [createProject, projectStorageInfo]);

  const handleReopen = async (project: Project) => {
    try {
      const fullProject = project.summary?.isSummary ? await getProject(project.id) : project;
      setCurrentProject(fullProject);
      setProjects(prev => prev.map(item => item.id === fullProject.id ? fullProject : item));
      const hasVirtualSetState = Array.isArray(fullProject.state?.virtualSet?.scenes) && fullProject.state.virtualSet.scenes.length > 0;
      const hasReferenceEditState = Boolean(fullProject.state?.referenceImage || fullProject.state?.targetImages?.length);
      setActiveView(hasVirtualSetState && !hasReferenceEditState ? 'virtual-set' : 'style-transfer');
    } catch (error) {
      console.error("Failed to open project", error);
      setToast("Could not open project");
    }
  };
  
  const handleDeleteProject = useCallback(async (id: string) => {
    try {
      await dbDeleteProject(id);
      setProjects(prev => prev.filter(p => p.id !== id));
      setProjectStorageInfo(await getProjectStorageInfo());
      if (currentProject?.id === id) {
        setCurrentProject(null);
      }
      setToast("Project deleted");
    } catch (err) {
      console.error("Failed to delete project from folder", err);
      setToast("Failed to delete project");
    }
  }, [currentProject]);

  const handleUpdateProject = useCallback(async (updatedProject: Project) => {
    try {
      await saveProject(updatedProject);
      setProjects(prev => prev.map(p => p.id === updatedProject.id ? { ...updatedProject, summary: undefined } : p));
      setCurrentProject(prev => prev?.id === updatedProject.id ? updatedProject : prev);
    } catch (err) {
      console.error("Failed to update project in folder", err);
      setToast("Project folder save failed");
    }
  }, []);

  const handleOpenProjectsFolder = useCallback(async () => {
    if (projectStorageInfo?.mode === 'browser') {
      setToast("On iPhone, use Export Backup to move projects.");
      return;
    }
    try {
      await openProjectsFolder();
    } catch (err) {
      console.error("Failed to open projects folder", err);
      setToast("Could not open projects folder");
    }
  }, [projectStorageInfo?.mode]);

  const handleExportProject = useCallback(async (project: Project) => {
    try {
      const blob = await exportProjectBackup(project.id);
      const safeName = project.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'ISTUDIO-project';
      downloadBlob(blob, `${safeName}.istudio.zip`);
      setToast('Project backup exported');
    } catch (error) {
      console.error('Failed to export project backup', error);
      setToast(error instanceof Error ? error.message : 'Could not export project backup');
    }
  }, []);

  const handleImportProject = useCallback(async (file: File) => {
    try {
      const importedProject = await importProjectBackup(file);
      const updatedProjects = await getProjects();
      setProjects(updatedProjects);
      setCurrentProject(importedProject);
      setActiveView('style-transfer');
      setProjectStorageInfo(await getProjectStorageInfo());
      setToast('Project backup imported');
    } catch (error) {
      console.error('Failed to import project backup', error);
      setToast(error instanceof Error ? error.message : 'Could not import project backup');
    }
  }, []);

  const handleUseVirtualSetRender = useCallback(async (image: ImageState, mode: 'reference' | 'background') => {
    const backgroundItem = {
      image,
      analysis: 'A rendered ISTUDIO Virtual Set background. Preserve the camera angle, lighting direction, atmosphere, and spatial depth from this render when replacing the scene.',
      enabled: true,
      status: 'ready' as const,
    };

    if (currentProject) {
      const updatedProject: Project = {
        ...currentProject,
        lastModified: Date.now(),
        state: {
          ...(currentProject.state || {}),
          ...(mode === 'reference'
            ? { referenceImage: image }
            : { customBackgroundItem: backgroundItem }),
        },
      };
      await handleUpdateProject(updatedProject);
      setCurrentProject(updatedProject);
      setActiveView('style-transfer');
      setToast(mode === 'reference' ? 'Virtual set loaded as reference DNA' : 'Virtual set loaded as background control');
      return;
    }

    if (mode === 'reference') {
      setPendingReferenceTemplate(image);
      setActiveView('style-transfer');
      setToast('Virtual set loaded as reference DNA');
      return;
    }

    const project = await createProject('Virtual Set Background Edit', 'style-transfer', {
      customBackgroundItem: backgroundItem,
    });
    if (project) {
      setToast('Virtual set loaded as background control');
    }
  }, [createProject, currentProject, handleUpdateProject]);

  const renderApiKeyRequired = () => (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="max-w-md space-y-6">
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--color-accent)]/10 shadow-[0_0_30px_var(--color-accent-glow)]">
          <SettingsIcon className="w-10 h-10 text-[var(--color-accent)]" />
        </div>
        <h2 className="text-3xl font-bold">Connect AI to unlock reference editing</h2>
        <p className="text-[var(--color-text-muted)] leading-relaxed">
          ISTUDIO reads the visual DNA of a reference photo, then uses it for background replacement, relighting, style transfer, and controlled image edits.
        </p>
        <div className="pt-4">
          <button
            onClick={handleOpenSelectKey}
            className="primary-cta px-10 py-4 text-sm font-semibold flex items-center gap-3 mx-auto"
          >
            Select API key
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] pt-4">
          Learn more about <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] hover:underline">Gemini API billing</a>.
        </p>
      </div>
    </div>
  );

  const renderContent = () => {
    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <SpinnerIcon className="w-10 h-10 animate-spin text-[var(--color-accent)]" />
            </div>
        );
    }
    
    return (
      <Suspense fallback={
        <div className="flex-1 flex items-center justify-center">
          <SpinnerIcon className="w-10 h-10 animate-spin text-[var(--color-accent)]" />
        </div>
      }>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeView}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          className="w-full h-full flex flex-col"
        >
          {activeView === 'dashboard' && (
            <DashboardView 
              onNavigate={handleNavigate} 
              onReopen={handleReopen}
              onCreateProject={handleCreateProject}
              onDeleteProject={handleDeleteProject}
              projects={projects} 
              hasUnsavedChanges={hasUnsavedChanges}
              imageTransfer={imageTransfer}
              storageInfo={projectStorageInfo}
              onOpenProjectsFolder={handleOpenProjectsFolder}
              canCreateProjects={Boolean(projectStorageInfo)}
              onSelectReferenceTemplate={handleSelectReferenceTemplate}
              onExportProject={handleExportProject}
              onImportProject={handleImportProject}
            />
          )}
          {activeView === 'style-transfer' && (hasApiKey ? (
            <StyleTransferView 
              project={currentProject}
              onUpdateProject={handleUpdateProject}
              onCreateProject={(name, initialState) => createProject(name, 'style-transfer', initialState)}
              referenceTemplate={pendingReferenceTemplate}
              onReferenceTemplateConsumed={() => setPendingReferenceTemplate(null)}
              storageMode={storageMode}
            />
          ) : renderApiKeyRequired())}
          {activeView === 'virtual-set' && (
            <VirtualSetView
              project={currentProject}
              onUpdateProject={handleUpdateProject}
              onCreateProject={(name, initialState) => createProject(name, 'virtual-set', initialState)}
              canCreateProjects={Boolean(projectStorageInfo)}
              onUseRender={handleUseVirtualSetRender}
            />
          )}
        </motion.div>
      </AnimatePresence>
      </Suspense>
    );
  };

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
    <div className="app-shell-grid relative flex h-[100dvh] w-screen flex-col overflow-hidden text-[var(--color-text)] font-sans antialiased">
      <header className="studio-topbar relative z-40 flex min-h-[68px] items-center gap-4 px-3 sm:px-5">
        <button
          onClick={() => handleNavigate('dashboard')}
          className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-white/[0.06] text-[var(--color-accent)] shadow-[0_14px_35px_rgba(0,0,0,0.28)] hover:bg-white/[0.09]"
          aria-label="Go to Dashboard"
        >
          <Logo className="h-6 w-6 transition-transform duration-300 group-hover:rotate-[-6deg] group-hover:scale-105" />
        </button>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
          <NavButton view="dashboard" label="Explore" icon={<LayoutDashboardIcon className="h-4 w-4" />} activeView={activeView} onNavigate={handleNavigate} />
          <NavButton view="style-transfer" label="Reference Edit" icon={<PaletteIcon className="h-4 w-4" />} activeView={activeView} onNavigate={handleNavigate} badge="Pro" />
          <NavButton view="virtual-set" label="Virtual Set" icon={<BoxIcon className="h-4 w-4" />} activeView={activeView} onNavigate={handleNavigate} badge={storageMode === 'browser' ? 'iPad' : undefined} />
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {activeView !== 'dashboard' && (
            <div className="hidden max-w-[260px] items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.055] px-3 py-2 text-xs text-[var(--color-text-muted)] md:flex">
              <ImagesIcon className="h-3.5 w-3.5 text-[var(--color-accent-secondary)]" />
              <span className="truncate">{currentProject?.name || 'Live session'}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsApiKeyModalOpen(true)}
            className={`hidden items-center gap-2 rounded-[12px] border px-3 py-2 text-xs font-extrabold sm:flex ${
              hasApiKey ? 'border-[var(--color-accent)]/20 bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${hasApiKey ? 'bg-[var(--color-accent)]' : 'bg-amber-400'}`} />
            {hasApiKey ? 'AI Ready' : 'Connect AI'}
          </button>
          <Tooltip text="Settings">
            <button
              onClick={() => setIsApiKeyModalOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/10 bg-white/[0.055] text-[var(--color-text-muted)] hover:bg-white/[0.09] hover:text-[var(--color-text)]"
              aria-label="Settings"
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip text="System info">
            <button
              onClick={() => setIsInfoPanelOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/10 bg-white/[0.055] text-[var(--color-text-muted)] hover:bg-white/[0.09] hover:text-[var(--color-text)]"
              aria-label="System info"
            >
              <HelpCircleIcon className="h-4 w-4" />
            </button>
          </Tooltip>
          <div className="hidden h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#151719] text-[var(--color-accent)] shadow-[0_14px_35px_rgba(0,0,0,0.24)] lg:flex">
            <SparklesIcon className="h-4 w-4" />
          </div>
        </div>
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
        {renderContent()}
      </main>

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveApiKey}
      />
      <AnimatePresence>
        {isInfoPanelOpen && (
          <InfoPanel
            isOpen={isInfoPanelOpen}
            onClose={() => setIsInfoPanelOpen(false)}
            projectCount={projects.length}
            historyCount={getProjectGenerationCount(projects)}
            hasApiKey={hasApiKey}
            storageInfo={projectStorageInfo}
          />
        )}
      </AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-6 right-6 z-50 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 text-sm text-[var(--color-text)] shadow-2xl"
        >
          {toast}
        </motion.div>
      )}
    </div>
    </MotionConfig>
  );
};

export default App;
