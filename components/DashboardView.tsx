import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  FolderOpen,
  ImagePlus,
  Images,
  Layers,
  Palette,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import type { AppView, ImageTransferState, Project, ReferenceTemplate } from '../types';
import { Logo } from '@/components/icons';
import type { ProjectStorageInfo } from '../services/db';
import { referenceTemplates } from '../data/referenceTemplates';

interface DashboardViewProps {
  onNavigate: (view: AppView) => void;
  onReopen: (project: Project) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (id: string) => void;
  projects: Project[];
  hasUnsavedChanges: boolean;
  imageTransfer: ImageTransferState | null;
  storageInfo: ProjectStorageInfo | null;
  onOpenProjectsFolder: () => void;
  canCreateProjects: boolean;
  onSelectReferenceTemplate: (template: ReferenceTemplate) => void;
}

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const getProjectOutputCount = (project: Project) => {
  const historyCount = Array.isArray(project.state?.generationHistory)
    ? project.state.generationHistory.length
    : 0;
  return Math.max(historyCount, project.generatedImages?.length || 0);
};

const getProjectCoverImages = (project: Project) => {
  const coverImages = project.generatedImages?.filter(Boolean) || [];
  if (coverImages.length > 0) return coverImages.slice(0, 4);

  if (Array.isArray(project.state?.generationHistory)) {
    return project.state.generationHistory
      .map((item: { generated?: string }) => item.generated)
      .filter((image: string | undefined): image is string => Boolean(image))
      .slice(0, 4);
  }

  return [];
};

const ProjectCard: React.FC<{
  project: Project;
  onOpen: (project: Project) => void;
  onDelete: (id: string) => void;
}> = ({ project, onOpen, onDelete }) => {
  const imageCount = getProjectOutputCount(project);
  const coverImages = getProjectCoverImages(project);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="group studio-panel-glow overflow-hidden rounded-xl premium-panel transition-colors hover:border-[var(--color-border-hover)]"
    >
      <button type="button" onClick={() => onOpen(project)} className="block w-full text-left">
        <div className="relative aspect-[16/10] overflow-hidden bg-[var(--color-canvas)]">
          {coverImages.length > 0 ? (
            <div className={`grid h-full w-full ${coverImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-px`}>
              {coverImages.map((image, index) => (
                <img
                  key={`${project.id}-${index}`}
                  src={image}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
                  referrerPolicy="no-referrer"
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <div className="grid w-full max-w-[190px] grid-cols-2 gap-3 opacity-70">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="aspect-square rounded-lg border border-dashed border-white/10 bg-white/[0.035]" />
                ))}
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 to-transparent p-4 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="text-xs font-semibold text-white">Open project</span>
            <ArrowRight className="h-4 w-4 text-[var(--color-accent)]" />
          </div>
        </div>
      </button>

      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{project.name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(project.lastModified)}
            </span>
            <span className="flex items-center gap-1.5">
              <Images className="h-3.5 w-3.5" />
              {imageCount} output{imageCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(project.id);
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
          aria-label={`Delete ${project.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </motion.article>
  );
};

const StatCard: React.FC<{ label: string; value: string; icon: React.ReactNode; accent?: string }> = ({ label, value, icon, accent = 'var(--color-accent)' }) => (
  <div className="studio-panel-glow rounded-xl premium-panel p-4">
    <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.055]" style={{ color: accent }}>
      {icon}
    </div>
    <p className="text-2xl font-black text-[var(--color-text)]">{value}</p>
    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{label}</p>
  </div>
);

const ReferenceTemplateGallery: React.FC<{
  onSelect: (template: ReferenceTemplate) => void;
}> = ({ onSelect }) => (
  <section className="space-y-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--color-accent)]">Reference DNA Templates</p>
        <h2 className="mt-2 text-2xl font-black text-[var(--color-text)]">Start with a visual blueprint.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
          Load a starter reference to define lighting, color, background, mood, and editorial finish before applying that DNA to your own photos.
        </p>
      </div>
      <div className="rounded-[12px] border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-extrabold text-[var(--color-text-muted)]">
        {referenceTemplates.length} visual blueprints
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {referenceTemplates.map((template, index) => (
        <motion.button
          key={template.id}
          type="button"
          onClick={() => onSelect(template)}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.04, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="group studio-panel-glow overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/84 text-left shadow-[var(--shadow-card)] hover:border-[var(--color-border-hover)]"
          aria-label={`Use ${template.title} as reference DNA`}
        >
          <div className="relative aspect-[16/10] overflow-hidden bg-[var(--color-canvas)]">
            <img
              src={template.url}
              alt={template.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]"
              referrerPolicy="no-referrer"
            />
            <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white backdrop-blur">
              {template.category}
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-black text-[var(--color-text)]">{template.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{template.description}</p>
              </div>
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.055] text-[var(--color-accent)] transition-transform group-hover:translate-x-0.5">
                <ArrowRight className="h-4 w-4" />
              </span>
            </div>
            <span className="mt-4 inline-flex items-center gap-2 text-xs font-extrabold text-[var(--color-accent)]">
              Use as DNA
              <Palette className="h-3.5 w-3.5" />
            </span>
          </div>
        </motion.button>
      ))}
    </div>
  </section>
);

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onReopen,
  onCreateProject,
  onDeleteProject,
  projects,
  hasUnsavedChanges,
  imageTransfer,
  storageInfo,
  onOpenProjectsFolder,
  canCreateProjects,
  onSelectReferenceTemplate,
}) => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.lastModified - a.lastModified),
    [projects],
  );
  const filteredProjects = sortedProjects.filter((project) =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const totalOutputs = projects.reduce((sum, project) => sum + getProjectOutputCount(project), 0);
  const canvasProjects = projects.filter((project) => Array.isArray(project.state?.canvas?.documents) && project.state.canvas.documents.length > 0);
  const featuredProject = useMemo(() => {
    if (sortedProjects.length === 0) return null;
    const previousProjects = sortedProjects.length > 1 ? sortedProjects.slice(1) : sortedProjects;
    const projectsWithOutputs = previousProjects.filter((project) => getProjectOutputCount(project) > 0);
    const candidates = projectsWithOutputs.length > 0 ? projectsWithOutputs : previousProjects;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }, [sortedProjects]);
  const featuredImages = useMemo(() => {
    const projectImages = featuredProject ? getProjectCoverImages(featuredProject) : [];
    if (projectImages.length > 0) return projectImages.slice(0, 4);
    return sortedProjects.flatMap(getProjectCoverImages).slice(0, 4);
  }, [featuredProject, sortedProjects]);

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newProjectName.trim()) return;
    if (!canCreateProjects) return;
    onCreateProject(newProjectName.trim());
    setNewProjectName('');
    setIsCreateModalOpen(false);
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-8 px-4 py-5 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0A0B0D] px-5 pb-6 pt-14 shadow-[var(--shadow-pop)] sm:px-8 lg:min-h-[650px] lg:px-12">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_center,rgba(var(--color-accent-rgb),0.14),transparent_48%)]" />
          <div className="relative mx-auto flex max-w-5xl flex-col items-center text-center">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mb-9 flex h-44 w-full max-w-[560px] items-center justify-center"
            >
              <div className="relative h-full w-full">
                {[0, 1, 2, 3].map((item) => {
                  const image = featuredImages[item];
                  const positions = [
                    'left-[6%] top-[42px] rotate-[-8deg]',
                    'left-[29%] top-[16px] rotate-[5deg]',
                    'left-[52%] top-[42px]',
                    'right-[5%] top-[34px] rotate-[4deg]',
                  ];
                  const dimensions = item === 2 ? 'h-32 w-32' : 'h-32 w-40';
                  const tileRadius = item === 2 ? 'rounded-full' : 'rounded-[18px]';
                  const floatAmount = item === 2 ? -5 : -7 - item;
                  const tiltAmount = item === 2 ? 0.6 : item % 2 === 0 ? 1.4 : -1.2;
                  return (
                    <div
                      key={item}
                      className={`absolute ${dimensions} ${positions[item]}`}
                    >
                      <motion.div
                        initial={{ opacity: 0, y: 12, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ delay: 0.08 * item, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                        className="h-full w-full"
                      >
                        <motion.div
                          className={`studio-media-tile h-full w-full overflow-hidden border border-white/12 p-1 ${tileRadius}`}
                          animate={{
                            y: [0, floatAmount],
                            rotate: [0, tiltAmount],
                            scale: [1, 1.012],
                          }}
                          transition={{
                            delay: 0.7 + item * 0.18,
                            duration: 3.3 + item * 0.35,
                            repeat: Infinity,
                            repeatType: 'mirror',
                            ease: 'easeInOut',
                          }}
                          style={{ transformOrigin: 'center center' }}
                        >
                          {image ? (
                            <img src={image} alt="" className={`h-full w-full object-cover ${tileRadius}`} />
                          ) : (
                            <div className={`flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,rgba(255,255,255,0.12),rgba(255,255,255,0.025))] ${tileRadius}`}>
                              {item === 0 && <ImagePlus className="h-7 w-7 text-[var(--color-accent-secondary)]" />}
                              {item === 1 && <Palette className="h-7 w-7 text-[var(--color-accent)]" />}
                              {item === 2 && <Sparkles className="h-7 w-7 text-[var(--color-accent)]" />}
                              {item === 3 && <Wand2 className="h-7 w-7 text-[var(--color-accent-secondary)]" />}
                            </div>
                          )}
                        </motion.div>
                      </motion.div>
                    </div>
                  );
                })}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.055] px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-[var(--color-text-muted)]"
            >
              <Logo className="h-4 w-4 text-[var(--color-accent)]" />
              ISTUDIO by Iconic Recordings
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.26, duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
              className="studio-hero-title mt-6 max-w-5xl text-4xl font-black uppercase leading-[0.96] text-[var(--color-text)] sm:text-6xl lg:text-7xl"
            >
              Edit photos from
              <span className="studio-lime-text block">another photo's DNA</span>
            </motion.h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)] sm:text-base">
              Reference-based editing for virtual background replacement, relighting, style transfer, and fine element control. Choose a source image, decide what to inherit, then apply that visual DNA to one photo or an entire batch.
            </p>

            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.36, duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
              className="studio-prompt-dock mt-16 w-full max-w-5xl rounded-[26px] p-4 text-left"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 rounded-[16px] border border-white/[0.07] bg-black/25 px-4 py-4">
                    <button type="button" onClick={() => setIsCreateModalOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-white/[0.065] text-[var(--color-text)]">
                      <Plus className="h-4 w-4" />
                    </button>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-[var(--color-text)]">
                        {featuredProject ? `Previous DNA edit: ${featuredProject.name}` : 'Create a reference-based edit'}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        Borrow the background, light, palette, mood, or selected elements from a reference photo.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => (featuredProject ? onReopen(featuredProject) : onNavigate('style-transfer'))} className="studio-chip inline-flex items-center gap-2 rounded-[12px] px-4 py-2 text-xs font-extrabold">
                      <Palette className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                      Reference Edit
                    </button>
                    <button type="button" onClick={() => onNavigate('canvas')} className="studio-chip inline-flex items-center gap-2 rounded-[12px] px-4 py-2 text-xs font-extrabold">
                      <Layers className="h-3.5 w-3.5 text-[var(--color-accent-secondary)]" />
                      Canvas
                    </button>
                    <button type="button" onClick={onOpenProjectsFolder} disabled={storageInfo?.mode !== 'folder'} className="studio-chip inline-flex items-center gap-2 rounded-[12px] px-4 py-2 text-xs font-extrabold disabled:opacity-40">
                      <FolderOpen className="h-3.5 w-3.5 text-[var(--color-accent-tertiary)]" />
                      Projects folder
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => (featuredProject ? onReopen(featuredProject) : setIsCreateModalOpen(true))}
                  disabled={!canCreateProjects && !featuredProject}
                  className="primary-cta flex min-h-[64px] items-center justify-center gap-2 px-8 text-sm disabled:opacity-40 lg:min-w-[190px]"
                >
                  {featuredProject ? 'Open' : 'Create'}
                  <Sparkles className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Local projects" value={String(projects.length)} icon={<Layers className="h-4 w-4" />} />
          <StatCard label="Finished edits" value={String(totalOutputs)} icon={<Images className="h-4 w-4" />} accent="var(--color-accent-secondary)" />
          <StatCard
            label="Canvas designs"
            value={String(canvasProjects.length)}
            icon={<CheckCircle2 className="h-4 w-4" />}
            accent="var(--color-accent-tertiary)"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            disabled={!canCreateProjects}
            className="group studio-panel-glow rounded-2xl premium-panel p-5 text-left disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[rgba(var(--color-accent-rgb),0.12)] text-[var(--color-accent)]">
                  <Palette className="h-5 w-5" />
                </span>
                <h2 className="mt-5 text-xl font-black text-[var(--color-text)]">Reference Edit</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--color-text-muted)]">
                  Transfer the lighting, background, mood, color, and selected visual elements from one photo into another.
                </p>
              </div>
              <ArrowRight className="mt-2 h-5 w-5 text-[var(--color-accent)] transition-transform group-hover:translate-x-1" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('canvas')}
            disabled={!canCreateProjects}
            className="group studio-panel-glow rounded-2xl premium-panel p-5 text-left disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-400/12 text-[var(--color-accent-secondary)]">
                  <Layers className="h-5 w-5" />
                </span>
                <h2 className="mt-5 text-xl font-black text-[var(--color-text)]">Canvas</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--color-text-muted)]">
                  Create single-page campaign layouts with editable image, text, shape, brush, template, and AI result layers.
                </p>
              </div>
              <ArrowRight className="mt-2 h-5 w-5 text-[var(--color-accent-secondary)] transition-transform group-hover:translate-x-1" />
            </div>
          </button>
        </section>

        <ReferenceTemplateGallery onSelect={onSelectReferenceTemplate} />

        <section className="space-y-5">
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">DNA Edit Library</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {projects.length === 0 ? 'Start a project to save reference DNA, target photos, generated edits, and settings.' : `${filteredProjects.length} of ${projects.length} local edit${projects.length === 1 ? '' : 's'} shown.`}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-0 sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  placeholder="Search projects"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full py-2.5 pl-10 pr-3 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                disabled={!canCreateProjects}
                className="btn-secondary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Create
              </button>
            </div>
          </div>

          {filteredProjects.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              <AnimatePresence mode="popLayout">
                {filteredProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={onReopen}
                    onDelete={onDeleteProject}
                  />
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/80 p-8 text-center">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--color-bg-elevated)] text-[var(--color-accent)]">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                {searchQuery ? 'No matching projects' : 'Start with a reference photo'}
              </h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--color-text-muted)]">
                {searchQuery ? `No projects match "${searchQuery}".` : 'Choose the photo DNA you want to borrow, add target images, then generate controlled edits with consistent light, background, and mood.'}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(true)}
                  disabled={!canCreateProjects}
                  className="primary-cta mt-6 inline-flex items-center gap-2 px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Wand2 className="h-4 w-4" />
                  Create edit
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCreateModalOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-md rounded-2xl premium-panel p-6 shadow-2xl"
            >
              <h2 className="text-lg font-semibold text-[var(--color-text)]">Create reference edit</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                Name the client, campaign, or batch. ISTUDIO will create a dedicated local folder for the reference, targets, outputs, and editing data.
              </p>

              <form onSubmit={handleCreate} className="mt-6 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-[var(--color-text-muted)]">Project name</label>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Editorial relight batch"
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    className="w-full px-4 py-3 text-sm"
                  />
                </div>

                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setIsCreateModalOpen(false)} className="btn-secondary px-4 py-2.5 text-sm">
                    Cancel
                  </button>
                  <button type="submit" disabled={!newProjectName.trim() || !canCreateProjects} className="primary-cta px-5 py-2.5 text-sm disabled:opacity-40">
                    Create
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
