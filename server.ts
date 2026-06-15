import express, { type ErrorRequestHandler } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECTS_DIR = path.resolve(process.env.ISTUDIO_PROJECTS_DIR || path.join(process.cwd(), 'projects'));
const PROJECT_JSON = 'project.json';
const PROJECT_PAYLOAD_LIMIT = process.env.ISTUDIO_PROJECT_PAYLOAD_LIMIT || '128mb';
const APP_DIR = path.resolve(process.cwd());
const PRO_AI_RUNTIME_DIR = path.join(APP_DIR, 'runtime', 'pro-ai');
const PRO_AI_MODELS_DIR = path.join(APP_DIR, 'models', 'pro-ai');
const PRO_AI_MANIFEST = path.join(PRO_AI_MODELS_DIR, 'manifest.json');
const PRO_AI_SETUP_TEMP = path.join(APP_DIR, '.istudio-pro-ai-temp');
const PROJECT_SCAN_MAX_DEPTH = 6;
const PROJECT_SCAN_IGNORED_DIRS = new Set([
  '.git',
  '.istudio-setup-temp',
  'dist',
  'dist-server',
  'node_modules',
  'runtime',
]);
const IMPORTABLE_IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);
const TETHER_SUPPORTED_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);
const TETHER_RAW_EXTENSIONS = new Set([
  '.3fr',
  '.arw',
  '.cr2',
  '.cr3',
  '.crw',
  '.dcr',
  '.dng',
  '.erf',
  '.fff',
  '.iiq',
  '.kdc',
  '.mef',
  '.mos',
  '.mrw',
  '.nef',
  '.nrw',
  '.orf',
  '.pef',
  '.raf',
  '.raw',
  '.rw2',
  '.rwl',
  '.sr2',
  '.srf',
  '.srw',
  '.x3f',
]);

type StoredProject = {
  id: string;
  name: string;
  createdAt: number;
  lastModified: number;
  state: unknown;
  generatedImages: string[];
};

type StoredAssetReference = {
  __istudioAsset: true;
  path: string;
  mimeType: string;
  fileName: string | null;
};

type StoredImageState = {
  fileName: string | null;
  base64: string | null;
  mimeType: string | null;
  width?: number | null;
  height?: number | null;
  assetPath?: string;
  assetUrl?: string;
};

type ImageAssetPayload = {
  bucket?: string;
  image?: StoredImageState;
  dataUrl?: string;
  fileName?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  matchFrame?: {
    width?: number | null;
    height?: number | null;
  };
};

type ImportableImageFile = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  mimeType: string;
  mtimeMs: number;
};

type TetherCaptureStatus = 'imported' | 'ignored' | 'failed';

type TetherCapture = {
  id: string;
  fileName: string;
  sourcePath: string;
  projectId: string | null;
  status: TetherCaptureStatus;
  message?: string;
  createdAt: number;
  importedAt?: number;
  image?: StoredImageState;
};

type TetherSession = {
  folderPath: string;
  projectId: string;
  autoEdit: boolean;
  startedAt: number;
};

type VirtualSetRenderPayload = {
  projectId: string;
  scene?: unknown;
  dataUrl: string;
  name?: string;
  width?: number;
  height?: number;
  format?: 'png' | 'jpeg' | 'webp';
};

type GeminiRelayPayload = {
  model?: string;
  contents?: unknown;
  config?: unknown;
  requestType?: 'analysis' | 'image-edit' | 'diagnostic';
};

type ProToolStatus = {
  available: boolean;
  installed: boolean;
  runtimeReady: boolean;
  acceleration: 'directml' | 'webgpu' | 'cpu' | 'unavailable';
  message: string;
  models: {
    id: string;
    task: string;
    installed: boolean;
    path?: string;
    inputSize?: number;
  }[];
};

type ProAiManifestModel = {
  id: string;
  task: 'segmentation' | 'matting' | 'upscale' | 'face-restore';
  file: string;
  inputSize?: number;
  channels?: 'rgb';
};

type ProAiManifest = {
  version?: number;
  models?: ProAiManifestModel[];
};

type ProToolImagePayload = {
  projectId: string;
  image?: StoredImageState;
  source?: 'target' | 'generated';
  settings?: Record<string, unknown>;
};

type ColorGradeRenderPayload = {
  projectId: string;
  target?: StoredImageState;
  reference?: StoredImageState;
  recipe?: {
    version?: string;
    size?: number;
    data?: number[];
    settings?: Record<string, unknown>;
    diagnostics?: unknown;
  };
  format?: 'png' | 'jpeg' | 'webp';
  fileName?: string;
};

type ProToolQueueTask<T> = () => Promise<T>;

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_RELAY_HEADER = 'x-istudio-gemini-key';
const GEMINI_RELAY_MAX_BYTES = 24 * 1024 * 1024;

let tetherWatcher: FSWatcher | null = null;
let tetherSession: TetherSession | null = null;
let tetherMessage: string | null = null;
const tetherCaptures: TetherCapture[] = [];
const tetherSeenSourceHashes = new Map<string, string>();
const tetherSeenContentHashes = new Set<string>();
const tetherImportTimers = new Map<string, NodeJS.Timeout>();

function safeFilePart(value: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

  return cleaned || 'project';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isImageState(value: unknown): value is StoredImageState {
  return isRecord(value) && 'base64' in value && 'mimeType' in value;
}

function isStoredAssetReference(value: unknown): value is StoredAssetReference {
  return isRecord(value) && value.__istudioAsset === true && typeof value.path === 'string';
}

function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('avif')) return 'avif';
  if (normalized.includes('tiff') || normalized.includes('tif')) return 'tif';
  if (normalized.includes('gltf-binary') || normalized.includes('glb')) return 'glb';
  if (normalized.includes('gltf+json') || normalized.includes('gltf')) return 'gltf';
  return 'bin';
}

function mimeTypeForExtension(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.glb') return 'model/gltf-binary';
  if (extension === '.gltf') return 'model/gltf+json';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.avif') return 'image/avif';
  if (extension === '.tif' || extension === '.tiff') return 'image/tiff';
  return 'image/jpeg';
}

function assetBucketForPath(segments: string[]): string {
  if (segments.includes('generationHistory')) {
    if (segments.at(-1) === 'generated') return 'outputs';
    if (segments.at(-1) === 'target') return 'targets';
    if (segments.at(-1) === 'reference') return 'reference';
  }
  if (segments.includes('virtualSet')) {
    if (segments.includes('renders') || segments.at(-1) === 'dataUrl') return 'virtual-set/renders';
    if (segments.includes('thumbnail') || segments.includes('thumbnails')) return 'virtual-set/thumbnails';
    if (segments.includes('scene') || segments.includes('scenes')) return 'virtual-set/scenes';
    return 'virtual-set/assets';
  }
  if (segments.includes('imageEditor')) {
    if (segments.includes('exports')) return 'editor/exports';
    if (segments.includes('mask') || segments.includes('masks')) return 'editor/masks';
    if (segments.includes('originalImage')) return 'editor/originals';
    if (segments.includes('layers')) return 'editor/layers';
    return 'editor/assets';
  }
  if (segments.includes('generatedImages') || segments.at(-1) === 'generated') return 'outputs';
  if (segments.includes('targetImages') && segments.includes('target')) return 'targets';
  if (segments.includes('referenceImage')) return 'reference';
  return 'assets';
}

function assetFileName(baseName: string, mimeType: string, base64: string): string {
  const extension = extensionForMime(mimeType);
  const hash = createHash('sha1').update(base64).digest('hex').slice(0, 12);
  return `${safeFilePart(baseName.replace(/\.[^/.]+$/, ''))}-${hash}.${extension}`;
}

function relativeAssetPath(projectDir: string, absolutePath: string): string {
  return path.relative(projectDir, absolutePath).replace(/\\/g, '/');
}

function assetUrlForProject(projectId: string, storedPath: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/assets/${storedPath.split('/').map(encodeURIComponent).join('/')}`;
}

function resolveProjectPath(projectDir: string, relativePath: string): string {
  const absolutePath = path.resolve(projectDir, relativePath);
  const projectRoot = path.resolve(projectDir);
  if (absolutePath !== projectRoot && !absolutePath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error('Project asset path escapes the project folder.');
  }
  return absolutePath;
}

function isInsideDirectory(parentDir: string, childPath: string): boolean {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

async function findProjectAssetByName(directory: string, fileName: string, depth = 0): Promise<string | null> {
  if (!fileName || depth > PROJECT_SCAN_MAX_DEPTH) return null;

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  const normalizedFileName = fileName.toLowerCase();
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === normalizedFileName) {
      return path.join(directory, entry.name);
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || PROJECT_SCAN_IGNORED_DIRS.has(entry.name.toLowerCase())) continue;
    const match = await findProjectAssetByName(path.join(directory, entry.name), fileName, depth + 1);
    if (match) return match;
  }

  return null;
}

async function resolvePortableProjectAsset(projectDir: string, storedPath: string): Promise<string | null> {
  const pathValue = storedPath.replace(/^file:\/+/i, '').trim();
  if (!pathValue) return null;

  try {
    if (path.isAbsolute(pathValue)) {
      if (isInsideDirectory(projectDir, pathValue) && existsSync(pathValue)) {
        return pathValue;
      }
    } else {
      const relativeAssetPath = resolveProjectPath(projectDir, pathValue.replace(/\\/g, '/'));
      if (existsSync(relativeAssetPath)) {
        return relativeAssetPath;
      }
    }
  } catch {
    // Imported projects may contain absolute paths from another computer. Fall back to filename lookup.
  }

  const fileName = pathValue.split(/[\\/]/).filter(Boolean).at(-1);
  return fileName ? findProjectAssetByName(projectDir, fileName) : null;
}

const ALLOWED_ASSET_BUCKETS = new Set([
  'reference',
  'targets',
  'outputs',
  'assets',
  'tether/inbox',
  'virtual-set/assets',
  'virtual-set/renders',
  'virtual-set/thumbnails',
  'virtual-set/scenes',
  'pro-tools/culling',
  'pro-tools/masks',
  'pro-tools/cutouts',
  'pro-tools/retouch',
  'pro-tools/finished',
  'editor/assets',
  'editor/originals',
  'editor/layers',
  'editor/exports',
  'editor/masks',
]);

function safeAssetBucket(value: unknown): string {
  if (typeof value !== 'string') return 'assets';
  const normalized = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return ALLOWED_ASSET_BUCKETS.has(normalized) ? normalized : 'assets';
}

function importedProjectId(projectDir: string): string {
  const relativePath = path.relative(PROJECTS_DIR, projectDir) || path.basename(projectDir);
  const hash = createHash('sha1').update(relativePath.toLowerCase()).digest('hex').slice(0, 12);
  return `imported-${hash}`;
}

function importedProjectName(projectDir: string): string {
  if (path.resolve(projectDir) === path.resolve(PROJECTS_DIR)) {
    return 'Loose Project Files';
  }
  return path.basename(projectDir).replace(/[-_]+/g, ' ').trim() || 'Imported Project';
}

async function listImportableImages(projectDir: string, depth = 0): Promise<ImportableImageFile[]> {
  if (depth > PROJECT_SCAN_MAX_DEPTH) return [];

  let entries;
  try {
    entries = await fs.readdir(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const imageFiles = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && IMPORTABLE_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map(async (entry) => {
        const absolutePath = path.join(projectDir, entry.name);
        const stats = await fs.stat(absolutePath).catch(() => null);
        if (!stats) return null;
        return {
          absolutePath,
          relativePath: relativeAssetPath(projectDir, absolutePath),
          fileName: entry.name,
          mimeType: mimeTypeForExtension(entry.name),
          mtimeMs: stats.mtimeMs,
        };
      }),
  );

  const nestedImages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !PROJECT_SCAN_IGNORED_DIRS.has(entry.name.toLowerCase()))
      .map(async (entry) => {
        const childDir = path.join(projectDir, entry.name);
        const childEntries = await fs.readdir(childDir, { withFileTypes: true }).catch(() => []);
        if (childEntries.some((child) => child.isFile() && child.name.toLowerCase() === PROJECT_JSON)) {
          return [];
        }
        return listImportableImages(childDir, depth + 1);
      }),
  );

  return [
    ...imageFiles.filter((image): image is ImportableImageFile => image !== null),
    ...nestedImages.flat(),
  ].sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function imageFileToState(projectDir: string, image: ImportableImageFile): StoredImageState {
  return {
    fileName: image.fileName,
    base64: null,
    mimeType: image.mimeType,
    width: null,
    height: null,
    assetPath: relativeAssetPath(projectDir, image.absolutePath),
  };
}

async function readImportedProjectFromFiles(projectDir: string): Promise<StoredProject | null> {
  const images = await listImportableImages(projectDir);
  if (images.length === 0) return null;

  const createdAt = Math.min(...images.map((image) => image.mtimeMs));
  const lastModified = Math.max(...images.map((image) => image.mtimeMs));
  const referenceImage = imageFileToState(projectDir, images[0]);
  const targetImages = images.map((image, index) => ({
    id: `${safeFilePart(image.fileName)}-${Math.round(image.mtimeMs)}-${index}`,
    target: imageFileToState(projectDir, image),
    generated: null,
    status: 'pending',
    dominantColor: null,
  }));

  return {
    id: importedProjectId(projectDir),
    name: importedProjectName(projectDir),
    createdAt,
    lastModified,
    generatedImages: [],
    state: {
      referenceImage,
      targetImages,
      generationHistory: [],
      recoveredFromFiles: true,
    },
  };
}

async function safeReadImportedProjectFromFiles(projectDir: string): Promise<StoredProject | null> {
  try {
    return await readImportedProjectFromFiles(projectDir);
  } catch (error) {
    console.warn(`Skipping imported project recovery for ${projectDir}`, error);
    return null;
  }
}

async function ensureProjectsDir() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
}

async function ensureProjectAssetDirs(projectDir: string) {
  await Promise.all([
    fs.mkdir(path.join(projectDir, 'reference'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'targets'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'outputs'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'assets'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'tether', 'inbox'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'pro-tools', 'culling'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'pro-tools', 'masks'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'pro-tools', 'cutouts'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'pro-tools', 'retouch'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'pro-tools', 'finished'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'originals'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'layers'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'exports'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'masks'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'assets'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'virtual-set', 'scenes'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'virtual-set', 'assets'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'virtual-set', 'renders'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'virtual-set', 'thumbnails'), { recursive: true }),
  ]);
}

async function findProjectJsonDirectories(directory: string, depth = 0): Promise<string[]> {
  if (depth > PROJECT_SCAN_MAX_DEPTH) return [];

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const hasProjectJson = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === PROJECT_JSON);
  if (hasProjectJson && path.resolve(directory) !== path.resolve(PROJECTS_DIR)) {
    return [directory];
  }

  const hasImportableImages = entries.some(
    (entry) => entry.isFile() && IMPORTABLE_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
  );

  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !PROJECT_SCAN_IGNORED_DIRS.has(entry.name.toLowerCase()))
      .map((entry) => findProjectJsonDirectories(path.join(directory, entry.name), depth + 1)),
  );

  return [...((hasProjectJson || hasImportableImages) ? [directory] : []), ...nested.flat()];
}

async function projectDirectories(): Promise<string[]> {
  await ensureProjectsDir();
  const directories = await findProjectJsonDirectories(PROJECTS_DIR);
  return Array.from(new Set(directories)).filter((directory) => isInsideDirectory(PROJECTS_DIR, directory));
}

async function legacyProjectFiles(): Promise<string[]> {
  await ensureProjectsDir();
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(PROJECTS_DIR, entry.name));
}

async function readRawProjectFile(filePath: string): Promise<StoredProject | null> {
  try {
    if (!existsSync(filePath)) return null;
    const raw = await fs.readFile(filePath, 'utf8');
    const project = JSON.parse(raw.replace(/^\uFEFF/, '')) as StoredProject;
    if (!project || typeof project.id !== 'string') return null;
    return project;
  } catch (error) {
    console.warn(`Skipping unreadable project file: ${filePath}`, error);
    return null;
  }
}

async function hydrateValue(value: unknown, projectDir: string, projectId: string, segments: string[] = []): Promise<unknown> {
  if (typeof value === 'string') {
    return value;
  }

  if (isStoredAssetReference(value)) {
    const assetPath = await resolvePortableProjectAsset(projectDir, value.path);
    if (!assetPath) {
      console.warn(`Missing imported project asset: ${path.join(projectDir, value.path)}`);
      return '';
    }
    return assetUrlForProject(projectId, relativeAssetPath(projectDir, assetPath));
  }

  if (isImageState(value)) {
    if (value.assetPath && value.mimeType) {
      const assetPath = await resolvePortableProjectAsset(projectDir, value.assetPath);
      if (!assetPath) {
        console.warn(`Missing imported project image: ${path.join(projectDir, value.assetPath)}`);
        return { ...value, base64: null, assetUrl: null };
      }
      const portablePath = relativeAssetPath(projectDir, assetPath);
      return {
        ...value,
        base64: null,
        assetPath: portablePath,
        assetUrl: assetUrlForProject(projectId, portablePath),
      };
    }
    if (value.base64 && value.mimeType) {
      const storedImage = await persistImageState(value, projectDir, segments);
      return {
        ...storedImage,
        base64: null,
        assetUrl: storedImage.assetPath ? assetUrlForProject(projectId, storedImage.assetPath) : null,
      };
    }
    return value;
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item, index) => hydrateValue(item, projectDir, projectId, [...segments, String(index)])));
  }

  if (isRecord(value)) {
    const hydratedEntries = await Promise.all(
      Object.entries(value).map(async ([key, entryValue]) => [key, await hydrateValue(entryValue, projectDir, projectId, [...segments, key])]),
    );
    return Object.fromEntries(hydratedEntries);
  }

  return value;
}

async function readProjectFromDirectory(projectDir: string): Promise<StoredProject | null> {
  const projectPath = path.join(projectDir, PROJECT_JSON);
  const project = await readRawProjectFile(projectPath);
  if (!project) {
    const importedProject = await safeReadImportedProjectFromFiles(projectDir);
    return importedProject ? await hydrateValue(importedProject, projectDir, importedProject.id) as StoredProject : null;
  }

  try {
    return await hydrateValue(project, projectDir, project.id) as StoredProject;
  } catch (error) {
    console.warn(`Recovering project with missing or invalid data: ${projectPath}`, error);
    const importedProject = await safeReadImportedProjectFromFiles(projectDir);
    if (importedProject) {
      try {
        return await hydrateValue(importedProject, projectDir, importedProject.id) as StoredProject;
      } catch (importError) {
        console.warn(`Imported recovery project could not be hydrated: ${projectDir}`, importError);
      }
    }
    return project;
  }
}

async function readProjects(): Promise<StoredProject[]> {
  await migrateLegacyProjectFiles();
  const directories = await projectDirectories();
  const projects = await Promise.all(directories.map(async (projectDir) => {
    try {
      return await readProjectFromDirectory(projectDir);
    } catch (error) {
      console.warn(`Skipping project that could not be loaded: ${projectDir}`, error);
      return null;
    }
  }));
  return projects
    .filter((project): project is StoredProject => project !== null)
    .sort((a, b) => (Number(b.lastModified) || 0) - (Number(a.lastModified) || 0));
}

function getArrayAtPath(value: unknown, keys: string[]): unknown[] {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return [];
    current = current[key];
  }
  return Array.isArray(current) ? current : [];
}

async function readProjectSummaryFromDirectory(projectDir: string): Promise<(StoredProject & { summary: { isSummary: true; outputCount: number; virtualSetSceneCount: number } }) | null> {
  const projectPath = path.join(projectDir, PROJECT_JSON);
  const project = await readRawProjectFile(projectPath) || await safeReadImportedProjectFromFiles(projectDir);
  if (!project) return null;

  const state = isRecord(project.state) ? project.state : {};
  const history = getArrayAtPath(state, ['generationHistory']);
  const targetImages = getArrayAtPath(state, ['targetImages']);
  const colorGradeOutputs = getArrayAtPath(state, ['colorGrade', 'outputs']);
  const virtualSetScenes = getArrayAtPath(state, ['virtualSet', 'scenes']);
  const generatedImages = Array.isArray(project.generatedImages) ? project.generatedImages : [];

  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    lastModified: project.lastModified,
    generatedImages: [],
    state: {},
    summary: {
      isSummary: true,
      outputCount: Math.max(history.length, generatedImages.length, targetImages.length, colorGradeOutputs.length),
      virtualSetSceneCount: virtualSetScenes.length,
    },
  };
}

async function readProjectSummaries(): Promise<(StoredProject & { summary: { isSummary: true; outputCount: number; virtualSetSceneCount: number } })[]> {
  await migrateLegacyProjectFiles();
  const directories = await projectDirectories();
  const summaries = await Promise.all(directories.map(async (projectDir) => {
    try {
      return await readProjectSummaryFromDirectory(projectDir);
    } catch (error) {
      console.warn(`Skipping project summary that could not be loaded: ${projectDir}`, error);
      return null;
    }
  }));
  return summaries
    .filter((project): project is StoredProject & { summary: { isSummary: true; outputCount: number; virtualSetSceneCount: number } } => project !== null)
    .sort((a, b) => (Number(b.lastModified) || 0) - (Number(a.lastModified) || 0));
}

async function findProjectDir(id: string): Promise<string | null> {
  const directories = await projectDirectories();
  for (const projectDir of directories) {
    const project = await readRawProjectFile(path.join(projectDir, PROJECT_JSON));
    if (project?.id === id) return projectDir;
    if (!project && importedProjectId(projectDir) === id) return projectDir;
  }
  return null;
}

async function findLegacyProjectFile(id: string): Promise<string | null> {
  const files = await legacyProjectFiles();
  for (const filePath of files) {
    const project = await readRawProjectFile(filePath);
    if (project?.id === id) return filePath;
  }
  return null;
}

async function persistImageState(value: StoredImageState, projectDir: string, segments: string[]): Promise<StoredImageState> {
  if (!value.base64 || !value.mimeType) {
    const { assetUrl: _assetUrl, ...portableValue } = value;
    return portableValue;
  }

  const bucket = assetBucketForPath(segments);
  const baseName = typeof value.fileName === 'string' && value.fileName.trim()
    ? value.fileName
    : segments.filter(Boolean).join('-') || 'image';
  const targetDir = path.join(projectDir, bucket);
  const targetPath = path.join(targetDir, assetFileName(baseName, value.mimeType, value.base64));

  await fs.mkdir(targetDir, { recursive: true });
  if (!existsSync(targetPath)) {
    await fs.writeFile(targetPath, Buffer.from(value.base64, 'base64'));
  }

  return {
    fileName: value.fileName,
    base64: null,
    mimeType: value.mimeType,
    width: value.width ?? null,
    height: value.height ?? null,
    assetPath: relativeAssetPath(projectDir, targetPath),
  };
}

async function persistDataUrl(value: string, projectDir: string, segments: string[]): Promise<StoredAssetReference | string> {
  const parsed = parseDataUrl(value);
  if (!parsed) return value;

  const bucket = assetBucketForPath(segments);
  const baseName = segments.filter(Boolean).join('-') || 'generated';
  const targetDir = path.join(projectDir, bucket);
  const targetPath = path.join(targetDir, assetFileName(baseName, parsed.mimeType, parsed.base64));

  await fs.mkdir(targetDir, { recursive: true });
  if (!existsSync(targetPath)) {
    await fs.writeFile(targetPath, Buffer.from(parsed.base64, 'base64'));
  }

  return {
    __istudioAsset: true,
    path: relativeAssetPath(projectDir, targetPath),
    mimeType: parsed.mimeType,
    fileName: path.basename(targetPath),
  };
}

async function writeImageAsset(projectId: string, payload: ImageAssetPayload): Promise<StoredImageState> {
  const projectDir = await findProjectDir(projectId);
  if (!projectDir) {
    throw new Error('Project not found.');
  }

  const image = payload.image;
  if (image?.assetPath && image.mimeType && !image.base64) {
    const assetPath = await resolvePortableProjectAsset(projectDir, image.assetPath);
    if (!assetPath) {
      throw new Error('Project image asset could not be found.');
    }
    const portablePath = relativeAssetPath(projectDir, assetPath);
    return {
      fileName: image.fileName || path.basename(assetPath),
      base64: null,
      mimeType: image.mimeType,
      width: image.width ?? null,
      height: image.height ?? null,
      assetPath: portablePath,
      assetUrl: assetUrlForProject(projectId, portablePath),
    };
  }

  const parsed = payload.dataUrl
    ? parseDataUrl(payload.dataUrl)
    : image?.base64 && (image.mimeType || payload.mimeType)
      ? { base64: image.base64, mimeType: image.mimeType || payload.mimeType! }
      : null;
  if (!parsed) {
    throw new Error('Image asset payload must include image data.');
  }

  const bucket = safeAssetBucket(payload.bucket);
  const baseName = payload.fileName || image?.fileName || `image-${Date.now()}`;
  const targetDir = path.join(projectDir, bucket);
  const requestedFrameWidth = Math.max(1, Math.round(Number(payload.matchFrame?.width || 0)));
  const requestedFrameHeight = Math.max(1, Math.round(Number(payload.matchFrame?.height || 0)));
  const shouldMatchFrame = requestedFrameWidth > 1 && requestedFrameHeight > 1;
  let outputMimeType = parsed.mimeType;
  let outputBuffer = Buffer.from(parsed.base64, 'base64');
  let outputWidth = payload.width ?? image?.width ?? null;
  let outputHeight = payload.height ?? image?.height ?? null;

  if (shouldMatchFrame) {
    const normalized = sharp(outputBuffer)
      .rotate()
      .resize(requestedFrameWidth, requestedFrameHeight, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
      })
      .withMetadata({ orientation: 1 });
    if (parsed.mimeType === 'image/jpeg') {
      outputBuffer = await normalized.jpeg({ quality: 98, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
      outputMimeType = 'image/jpeg';
    } else if (parsed.mimeType === 'image/webp') {
      outputBuffer = await normalized.webp({ quality: 98, smartSubsample: true }).toBuffer();
      outputMimeType = 'image/webp';
    } else {
      outputBuffer = await normalized.png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
      outputMimeType = 'image/png';
    }
    outputWidth = requestedFrameWidth;
    outputHeight = requestedFrameHeight;
  }

  const outputBase64 = outputBuffer.toString('base64');
  const targetPath = path.join(targetDir, assetFileName(baseName, outputMimeType, outputBase64));

  await fs.mkdir(targetDir, { recursive: true });
  if (!existsSync(targetPath)) {
    await fs.writeFile(targetPath, outputBuffer);
  }

  const portablePath = relativeAssetPath(projectDir, targetPath);
  return {
    fileName: baseName,
    base64: null,
    mimeType: outputMimeType,
    width: outputWidth,
    height: outputHeight,
    assetPath: portablePath,
    assetUrl: assetUrlForProject(projectId, portablePath),
  };
}

async function persistValue(value: unknown, projectDir: string, segments: string[] = []): Promise<unknown> {
  if (typeof value === 'string') {
    return persistDataUrl(value, projectDir, segments);
  }

  if (isImageState(value)) {
    return persistImageState(value, projectDir, segments);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item, index) => persistValue(item, projectDir, [...segments, String(index)])));
  }

  if (isRecord(value)) {
    const storedEntries = await Promise.all(
      Object.entries(value).map(async ([key, entryValue]) => [key, await persistValue(entryValue, projectDir, [...segments, key])]),
    );
    return Object.fromEntries(storedEntries);
  }

  return value;
}

async function writeProject(project: StoredProject) {
  await ensureProjectsDir();
  const existingDir = await findProjectDir(project.id);
  const legacyFile = await findLegacyProjectFile(project.id);
  const reusableExistingDir = existingDir && path.resolve(existingDir) !== path.resolve(PROJECTS_DIR) ? existingDir : null;
  const targetDir = reusableExistingDir || path.join(PROJECTS_DIR, `${safeFilePart(project.name)}-${project.id}`);
  const tempPath = path.join(targetDir, `${PROJECT_JSON}.tmp`);
  const projectPath = path.join(targetDir, PROJECT_JSON);

  await fs.mkdir(targetDir, { recursive: true });
  await ensureProjectAssetDirs(targetDir);

  const storedProject = await persistValue(project, targetDir) as StoredProject;
  await fs.writeFile(tempPath, JSON.stringify(storedProject, null, 2), 'utf8');
  await fs.rename(tempPath, projectPath);

  if (legacyFile && existsSync(legacyFile)) {
    await fs.unlink(legacyFile);
  }
}

async function deleteProjectFolder(id: string) {
  const projectDir = await findProjectDir(id);
  if (projectDir) {
    await fs.rm(projectDir, { recursive: true, force: true });
  }

  const legacyFile = await findLegacyProjectFile(id);
  if (legacyFile) {
    await fs.unlink(legacyFile);
  }
}

async function migrateLegacyProjectFiles() {
  const files = await legacyProjectFiles();
  for (const filePath of files) {
    try {
      const project = await readRawProjectFile(filePath);
      if (!project) continue;
      await writeProject(project);
    } catch (error) {
      console.warn(`Skipping legacy project migration for ${filePath}`, error);
    }
  }
}

function openFolder(folderPath: string) {
  if (process.platform === 'win32') {
    return spawn('explorer', [folderPath], { detached: true, stdio: 'ignore' });
  }
  if (process.platform === 'darwin') {
    return spawn('open', [folderPath], { detached: true, stdio: 'ignore' });
  }
  return spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' });
}

async function writeVirtualSetScene(projectDir: string, scene: unknown) {
  if (!scene) return null;
  const sceneId = isRecord(scene) && typeof scene.id === 'string' ? safeFilePart(scene.id) : `scene-${Date.now()}`;
  const scenePath = path.join(projectDir, 'virtual-set', 'scenes', `${sceneId}.json`);
  await fs.mkdir(path.dirname(scenePath), { recursive: true });
  await fs.writeFile(scenePath, JSON.stringify(scene, null, 2), 'utf8');
  return relativeAssetPath(projectDir, scenePath);
}

async function writeVirtualSetRender(payload: VirtualSetRenderPayload) {
  const projectDir = await findProjectDir(payload.projectId);
  if (!projectDir) {
    throw new Error('Project not found. Create a project before rendering a virtual set.');
  }

  const parsed = parseDataUrl(payload.dataUrl);
  if (!parsed) {
    throw new Error('Virtual Set render payload must be a data URL.');
  }

  await ensureProjectAssetDirs(projectDir);
  const scenePath = await writeVirtualSetScene(projectDir, payload.scene);
  const renderId = `virtual-set-render-${Date.now()}`;
  const baseName = payload.name || renderId;
  const targetDir = path.join(projectDir, 'virtual-set', 'renders');
  const targetPath = path.join(targetDir, assetFileName(baseName, parsed.mimeType, parsed.base64));
  await fs.mkdir(targetDir, { recursive: true });
  if (!existsSync(targetPath)) {
    await fs.writeFile(targetPath, Buffer.from(parsed.base64, 'base64'));
  }

  return {
    id: renderId,
    name: baseName,
    dataUrl: payload.dataUrl,
    mimeType: parsed.mimeType,
    width: payload.width || null,
    height: payload.height || null,
    createdAt: Date.now(),
    assetPath: relativeAssetPath(projectDir, targetPath),
    scenePath,
    image: {
      fileName: path.basename(targetPath),
      base64: parsed.base64,
      mimeType: parsed.mimeType,
      width: payload.width || null,
      height: payload.height || null,
      assetPath: relativeAssetPath(projectDir, targetPath),
    },
  };
}

async function useVirtualSetRenderAsReference(projectId: string, image: StoredImageState) {
  const projectDir = await findProjectDir(projectId);
  if (!projectDir) {
    throw new Error('Project not found.');
  }
  const project = await readProjectFromDirectory(projectDir);
  if (!project) {
    throw new Error('Project not found.');
  }

  const state = isRecord(project.state) ? project.state : {};
  const updatedProject: StoredProject = {
    ...project,
    lastModified: Date.now(),
    state: {
      ...state,
      referenceImage: image,
    },
  };
  await writeProject(updatedProject);
  return readProjectFromDirectory(projectDir);
}

let proToolQueue: Promise<unknown> = Promise.resolve();
let cachedOrt: unknown | null = null;

function enqueueProTool<T>(task: ProToolQueueTask<T>): Promise<T> {
  const next = proToolQueue.then(task, task);
  proToolQueue = next.catch(() => undefined);
  return next;
}

async function readProAiManifest(): Promise<ProAiManifest> {
  try {
    const raw = await fs.readFile(PRO_AI_MANIFEST, 'utf8');
    return JSON.parse(raw) as ProAiManifest;
  } catch {
    return { version: 1, models: [] };
  }
}

async function getOrtRuntime(): Promise<any | null> {
  if (cachedOrt) return cachedOrt;
  try {
    cachedOrt = await import('onnxruntime-node');
    return cachedOrt;
  } catch (error) {
    console.warn('ONNX Runtime is unavailable.', error);
    return null;
  }
}

async function getProToolStatus(): Promise<ProToolStatus> {
  const manifest = await readProAiManifest();
  const ort = await getOrtRuntime();
  const models = await Promise.all((manifest.models || []).map(async (model) => {
    const modelPath = path.join(PRO_AI_MODELS_DIR, model.file);
    return {
      id: model.id,
      task: model.task,
      installed: existsSync(modelPath),
      path: existsSync(modelPath) ? path.relative(APP_DIR, modelPath).replace(/\\/g, '/') : undefined,
      inputSize: model.inputSize,
    };
  }));
  const installed = models.some((model) => model.installed) || existsSync(PRO_AI_RUNTIME_DIR) || existsSync(PRO_AI_MODELS_DIR);
  return {
    available: Boolean(ort),
    installed,
    runtimeReady: Boolean(ort),
    acceleration: Boolean(ort) ? 'directml' : 'unavailable',
    message: !ort
      ? 'Local Pro AI runtime is not available in this install.'
      : installed
        ? 'Local Pro AI tools are ready. GPU acceleration is used when Windows exposes DirectML; CPU fallback is automatic.'
        : 'Local Pro AI Pack is not installed yet.',
    models,
  };
}

async function resolveImagePayload(projectId: string, image?: StoredImageState): Promise<{ projectDir: string; buffer: Buffer; fileName: string; mimeType: string; width: number | null; height: number | null }> {
  const projectDir = await findProjectDir(projectId);
  if (!projectDir) throw new Error('Project not found.');
  if (!image) throw new Error('Choose an image before using Pro Tools.');

  if (image.assetPath) {
    const assetPath = await resolvePortableProjectAsset(projectDir, image.assetPath);
    if (!assetPath) throw new Error('The selected project image could not be found.');
    const buffer = await fs.readFile(assetPath);
    const metadata = await sharp(buffer).metadata();
    return {
      projectDir,
      buffer,
      fileName: image.fileName || path.basename(assetPath),
      mimeType: image.mimeType || mimeTypeForExtension(assetPath),
      width: metadata.width || image.width || null,
      height: metadata.height || image.height || null,
    };
  }

  if (image.assetUrl?.startsWith(`/api/projects/${encodeURIComponent(projectId)}/assets/`)) {
    const encodedPath = image.assetUrl.split(`/api/projects/${encodeURIComponent(projectId)}/assets/`)[1] || '';
    const requestedPath = decodeURIComponent(encodedPath).replace(/\\/g, '/');
    const assetPath = await resolvePortableProjectAsset(projectDir, requestedPath);
    if (!assetPath) throw new Error('The selected generated image could not be found.');
    const buffer = await fs.readFile(assetPath);
    const metadata = await sharp(buffer).metadata();
    return {
      projectDir,
      buffer,
      fileName: image.fileName || path.basename(assetPath),
      mimeType: image.mimeType || mimeTypeForExtension(assetPath),
      width: metadata.width || image.width || null,
      height: metadata.height || image.height || null,
    };
  }

  if (image.base64 && image.mimeType) {
    const buffer = Buffer.from(image.base64, 'base64');
    const metadata = await sharp(buffer).metadata();
    return {
      projectDir,
      buffer,
      fileName: image.fileName || `pro-image-${Date.now()}.${extensionForMime(image.mimeType)}`,
      mimeType: image.mimeType,
      width: metadata.width || image.width || null,
      height: metadata.height || image.height || null,
    };
  }

  throw new Error('The selected image is not available to Pro Tools.');
}

async function writeProToolBuffer(projectId: string, projectDir: string, bucket: string, buffer: Buffer, fileName: string, mimeType: string, width?: number | null, height?: number | null): Promise<StoredImageState> {
  const safeBucket = safeAssetBucket(bucket);
  const base64Hash = createHash('sha1').update(buffer).digest('hex').slice(0, 12);
  const extension = extensionForMime(mimeType);
  const targetDir = path.join(projectDir, safeBucket);
  const targetPath = path.join(targetDir, `${safeFilePart(fileName.replace(/\.[^/.]+$/, ''))}-${base64Hash}.${extension}`);
  await fs.mkdir(targetDir, { recursive: true });
  if (!existsSync(targetPath)) {
    await fs.writeFile(targetPath, buffer);
  }
  const portablePath = relativeAssetPath(projectDir, targetPath);
  return {
    fileName: path.basename(targetPath),
    base64: null,
    mimeType,
    width: width ?? null,
    height: height ?? null,
    assetPath: portablePath,
    assetUrl: assetUrlForProject(projectId, portablePath),
  };
}

function sampleColorGradeLut(
  red: number,
  green: number,
  blue: number,
  size: number,
  values: number[],
): [number, number, number] {
  const scaledRed = Math.max(0, Math.min(size - 1, red / 255 * (size - 1)));
  const scaledGreen = Math.max(0, Math.min(size - 1, green / 255 * (size - 1)));
  const scaledBlue = Math.max(0, Math.min(size - 1, blue / 255 * (size - 1)));
  const red0 = Math.floor(scaledRed);
  const green0 = Math.floor(scaledGreen);
  const blue0 = Math.floor(scaledBlue);
  const red1 = Math.min(size - 1, red0 + 1);
  const green1 = Math.min(size - 1, green0 + 1);
  const blue1 = Math.min(size - 1, blue0 + 1);
  const redMix = scaledRed - red0;
  const greenMix = scaledGreen - green0;
  const blueMix = scaledBlue - blue0;
  const read = (r: number, g: number, b: number, channel: number) => (
    values[((b * size + g) * size + r) * 3 + channel] || 0
  );
  const output: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = read(red0, green0, blue0, channel);
    const c100 = read(red1, green0, blue0, channel);
    const c010 = read(red0, green1, blue0, channel);
    const c110 = read(red1, green1, blue0, channel);
    const c001 = read(red0, green0, blue1, channel);
    const c101 = read(red1, green0, blue1, channel);
    const c011 = read(red0, green1, blue1, channel);
    const c111 = read(red1, green1, blue1, channel);
    const c00 = c000 + (c100 - c000) * redMix;
    const c10 = c010 + (c110 - c010) * redMix;
    const c01 = c001 + (c101 - c001) * redMix;
    const c11 = c011 + (c111 - c011) * redMix;
    const c0 = c00 + (c10 - c00) * greenMix;
    const c1 = c01 + (c11 - c01) * greenMix;
    output[channel] = c0 + (c1 - c0) * blueMix;
  }
  return output;
}

async function analyzeColorGradeImage(projectId: string, image?: StoredImageState) {
  const imageData = await resolveImagePayload(projectId, image);
  const { data, info } = await sharp(imageData.buffer)
    .rotate()
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const histogram = Array.from({ length: 256 }, () => 0);
  const channelMeans = [0, 0, 0];
  let clippedShadows = 0;
  let clippedHighlights = 0;
  let contrast = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luminance = Math.max(0, Math.min(255, Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue)));
    histogram[luminance] += 1;
    channelMeans[0] += red;
    channelMeans[1] += green;
    channelMeans[2] += blue;
    if (luminance < 4) clippedShadows += 1;
    if (luminance > 251) clippedHighlights += 1;
    if (index >= info.channels) {
      const prior = Math.round(0.2126 * data[index - info.channels] + 0.7152 * data[index - info.channels + 1] + 0.0722 * data[index - info.channels + 2]);
      contrast += Math.abs(luminance - prior);
    }
    count += 1;
  }
  return {
    width: imageData.width,
    height: imageData.height,
    histogram,
    meanRgb: channelMeans.map((value) => value / Math.max(1, count)),
    localContrast: contrast / Math.max(1, count) / 255,
    clippedShadows: clippedShadows / Math.max(1, count),
    clippedHighlights: clippedHighlights / Math.max(1, count),
  };
}

async function renderColorGradeImage(payload: ColorGradeRenderPayload) {
  const imageData = await resolveImagePayload(payload.projectId, payload.target);
  const size = Math.max(2, Math.min(33, Number(payload.recipe?.size || 0)));
  const lut = Array.isArray(payload.recipe?.data) ? payload.recipe!.data! : [];
  if (lut.length !== size * size * size * 3) {
    throw new Error('The Master Match render recipe is incomplete. Run Master Match again.');
  }
  const metadata = await sharp(imageData.buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('ISTUDIO could not read the target image dimensions.');
  }
  const swapsDimensions = metadata.orientation !== undefined
    && metadata.orientation >= 5
    && metadata.orientation <= 8;
  const width = swapsDimensions ? metadata.height : metadata.width;
  const height = swapsDimensions ? metadata.width : metadata.height;
  const settings = payload.recipe?.settings || {};
  const vignette = Math.max(-100, Math.min(100, Number(settings.vignette || 0))) / 100;
  const grain = Math.max(0, Math.min(100, Number(settings.grain || 0))) / 100;
  const centerX = width / 2;
  const centerY = height / 2;
  const maximumDistance = Math.max(1, Math.hypot(centerX, centerY));
  const format = payload.format || 'png';
  const clarity = Math.max(-100, Math.min(100, Number(settings.clarity || 0)));
  const sharpness = Math.max(-100, Math.min(100, Number(settings.sharpness || 0)));
  const renderTempDir = path.join(imageData.projectDir, '.color-grade-temp');
  const rawPath = path.join(renderTempDir, `${safeFilePart(imageData.fileName)}-${Date.now()}.rgba`);
  await fs.mkdir(renderTempDir, { recursive: true });
  const rawHandle = await fs.open(rawPath, 'w');
  const tileHeight = 384;
  let output: Buffer;
  let mimeType: string;
  try {
    for (let top = 0; top < height; top += tileHeight) {
      const currentHeight = Math.min(tileHeight, height - top);
      const decoded = await sharp(imageData.buffer)
        .rotate()
        .ensureAlpha()
        .toColourspace('srgb')
        .extract({ left: 0, top, width, height: currentHeight })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const { data, info } = decoded;
      for (let index = 0; index < data.length; index += info.channels) {
        const pixel = index / info.channels;
        const x = pixel % width;
        const y = top + Math.floor(pixel / width);
        const mapped = sampleColorGradeLut(data[index], data[index + 1], data[index + 2], size, lut);
        let multiplier = 1;
        if (vignette !== 0) {
          const distance = Math.min(1, Math.hypot(x - centerX, y - centerY) / maximumDistance);
          multiplier *= Math.max(0.55, Math.min(1.45, 1 - vignette * Math.pow(distance, 1.8) * 0.48));
        }
        const noise = grain > 0
          ? ((((x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1 - 0.5) * grain * 9
          : 0;
        data[index] = Math.max(0, Math.min(255, Math.round(mapped[0] * 255 * multiplier + noise)));
        data[index + 1] = Math.max(0, Math.min(255, Math.round(mapped[1] * 255 * multiplier + noise)));
        data[index + 2] = Math.max(0, Math.min(255, Math.round(mapped[2] * 255 * multiplier + noise)));
      }
      await rawHandle.write(data);
    }
    await rawHandle.close();

    let pipeline = sharp({
      raw: { width, height, channels: 4 },
    });
    if (clarity > 0) {
      pipeline = pipeline.sharpen({ sigma: 1.25, m1: 0.55, m2: 1 + clarity / 80 });
    } else if (clarity < 0) {
      pipeline = pipeline.blur(Math.max(0.3, Math.min(1.2, Math.abs(clarity) / 90)));
    }
    if (sharpness > 0) {
      pipeline = pipeline.sharpen({ sigma: 0.65 + sharpness / 90, m1: 0.8, m2: 1.5 });
    }
    pipeline = pipeline.withMetadata({
      orientation: 1,
      density: metadata.density,
    });
    if (format === 'jpeg') {
      pipeline = pipeline.removeAlpha().jpeg({ quality: 96, chromaSubsampling: '4:4:4', mozjpeg: true });
      mimeType = 'image/jpeg';
    } else if (format === 'webp') {
      pipeline = pipeline.webp({ quality: 96, smartSubsample: true });
      mimeType = 'image/webp';
    } else {
      pipeline = pipeline.png({ compressionLevel: 6, adaptiveFiltering: true });
      mimeType = 'image/png';
    }
    const outputPromise = pipeline.toBuffer();
    createReadStream(rawPath).pipe(pipeline);
    output = await outputPromise;
  } finally {
    await rawHandle.close().catch(() => undefined);
    await fs.rm(rawPath, { force: true }).catch(() => undefined);
    await fs.rmdir(renderTempDir).catch(() => undefined);
  }
  const fileName = payload.fileName || `${imageData.fileName.replace(/\.[^/.]+$/, '')}-master-match`;
  const image = await writeProToolBuffer(
    payload.projectId,
    imageData.projectDir,
    'outputs',
    output,
    fileName,
    mimeType,
    width,
    height,
  );
  return {
    image,
    diagnostics: payload.recipe?.diagnostics || null,
    engineVersion: payload.recipe?.version || 'unknown',
    width,
    height,
  };
}

async function analyzeLocalImage(payload: ProToolImagePayload) {
  return enqueueProTool(async () => {
    const imageData = await resolveImagePayload(payload.projectId, payload.image);
    const pipeline = sharp(imageData.buffer).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).removeAlpha().greyscale();
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    const totalPixels = Math.max(1, info.width * info.height);

    let sum = 0;
    let sumSq = 0;
    let clippedDark = 0;
    let clippedBright = 0;
    for (const value of data) {
      sum += value;
      sumSq += value * value;
      if (value < 8) clippedDark += 1;
      if (value > 247) clippedBright += 1;
    }
    const mean = sum / totalPixels;
    const variance = Math.max(0, sumSq / totalPixels - mean * mean);

    let laplacian = 0;
    let samples = 0;
    const width = info.width;
    const height = info.height;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const value = (data[index] * 4) - data[index - 1] - data[index + 1] - data[index - width] - data[index + width];
        laplacian += value * value;
        samples += 1;
      }
    }

    const sharpnessScore = Math.min(100, Math.round(Math.sqrt(laplacian / Math.max(1, samples)) * 2.2));
    const exposureBalance = 100 - Math.min(100, Math.abs(mean - 128) * 0.9 + ((clippedDark + clippedBright) / totalPixels) * 120);
    const contrastScore = Math.min(100, Math.round(Math.sqrt(variance) * 2.3));
    const cullScore = Math.max(0, Math.min(100, Math.round((sharpnessScore * 0.46) + (exposureBalance * 0.34) + (contrastScore * 0.2))));
    const flags: string[] = [];
    if (sharpnessScore < 38) flags.push('Soft focus');
    if (mean < 58) flags.push('Underexposed');
    if (mean > 205) flags.push('Overexposed');
    if ((clippedBright / totalPixels) > 0.08) flags.push('Blown highlights');
    if ((clippedDark / totalPixels) > 0.12) flags.push('Crushed shadows');
    if (contrastScore < 26) flags.push('Flat contrast');

    const result = {
      score: cullScore,
      pickStatus: cullScore >= 72 ? 'pick' : cullScore < 44 ? 'reject' : 'review',
      rating: cullScore >= 86 ? 5 : cullScore >= 72 ? 4 : cullScore >= 58 ? 3 : cullScore >= 44 ? 2 : 1,
      flags,
      sharpnessScore,
      exposureScore: Math.round(exposureBalance),
      contrastScore,
      faceCount: null,
      eyeStatus: 'Model pack face checks pending',
      analyzedAt: Date.now(),
    };

    const reportPath = path.join(imageData.projectDir, 'pro-tools', 'culling', `${safeFilePart(imageData.fileName)}-${Date.now()}.json`);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  });
}

async function createFallbackAlphaMask(buffer: Buffer): Promise<{ mask: Buffer; width: number; height: number; sourcePng: Buffer }> {
  const source = sharp(buffer).rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).removeAlpha();
  const metadata = await source.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const sourcePng = await source.png().toBuffer();
  const { data } = await sharp(sourcePng).raw().toBuffer({ resolveWithObject: true });
  const borderSamples: number[][] = [];
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 80));
  const pushPixel = (x: number, y: number) => {
    const index = (y * width + x) * 3;
    borderSamples.push([data[index], data[index + 1], data[index + 2]]);
  };
  for (let x = 0; x < width; x += sampleStep) {
    pushPixel(x, 0);
    pushPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += sampleStep) {
    pushPixel(0, y);
    pushPixel(width - 1, y);
  }
  const background = borderSamples.reduce((acc, pixel) => {
    acc[0] += pixel[0];
    acc[1] += pixel[1];
    acc[2] += pixel[2];
    return acc;
  }, [0, 0, 0]).map((value) => value / Math.max(1, borderSamples.length));

  const alpha = Buffer.alloc(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const rgbIndex = index * 3;
    const distance = Math.sqrt(
      ((data[rgbIndex] - background[0]) ** 2) +
      ((data[rgbIndex + 1] - background[1]) ** 2) +
      ((data[rgbIndex + 2] - background[2]) ** 2),
    );
    const normalized = Math.max(0, Math.min(255, (distance - 22) * 4.2));
    alpha[index] = normalized;
  }

  const mask = await sharp(alpha, { raw: { width, height, channels: 1 } })
    .median(3)
    .blur(1.2)
    .png()
    .toBuffer();
  return { mask, width, height, sourcePng };
}

async function runOnnxSegmentation(buffer: Buffer): Promise<{ mask: Buffer; width: number; height: number; sourcePng: Buffer; modelId: string } | null> {
  const manifest = await readProAiManifest();
  const model = (manifest.models || []).find((candidate) => {
    const modelPath = path.join(PRO_AI_MODELS_DIR, candidate.file);
    return candidate.task === 'segmentation' && existsSync(modelPath);
  });
  if (!model) return null;
  const ort = await getOrtRuntime();
  if (!ort) return null;

  const inputSize = model.inputSize || 320;
  const modelPath = path.join(PRO_AI_MODELS_DIR, model.file);
  const source = sharp(buffer).rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).removeAlpha();
  const metadata = await source.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const sourcePng = await source.png().toBuffer();
  const input = await sharp(sourcePng).resize(inputSize, inputSize, { fit: 'fill' }).raw().toBuffer();
  const tensorData = new Float32Array(1 * 3 * inputSize * inputSize);
  const pixels = inputSize * inputSize;
  for (let i = 0; i < pixels; i += 1) {
    tensorData[i] = input[i * 3] / 255;
    tensorData[pixels + i] = input[i * 3 + 1] / 255;
    tensorData[pixels * 2 + i] = input[i * 3 + 2] / 255;
  }

  let session;
  try {
    session = await ort.InferenceSession.create(modelPath, { executionProviders: ['dml', 'cpu'] });
  } catch {
    session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  }

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const feeds: Record<string, unknown> = {
    [inputName]: new ort.Tensor('float32', tensorData, [1, 3, inputSize, inputSize]),
  };
  const output = await session.run(feeds);
  const outputTensor = output[outputName];
  const raw = Array.from(outputTensor.data as Float32Array | number[]);
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  const scale = max > min ? 255 / (max - min) : 1;
  const alpha = Buffer.alloc(inputSize * inputSize);
  for (let index = 0; index < inputSize * inputSize; index += 1) {
    alpha[index] = Math.max(0, Math.min(255, Math.round((raw[index] - min) * scale)));
  }
  const mask = await sharp(alpha, { raw: { width: inputSize, height: inputSize, channels: 1 } })
    .resize(width, height, { fit: 'fill' })
    .median(3)
    .blur(0.8)
    .png()
    .toBuffer();
  return { mask, width, height, sourcePng, modelId: model.id };
}

async function removeLocalBackground(payload: ProToolImagePayload) {
  return enqueueProTool(async () => {
    const imageData = await resolveImagePayload(payload.projectId, payload.image);
    const segmentation = await runOnnxSegmentation(imageData.buffer).catch((error) => {
      console.warn('ONNX cutout failed; using fallback alpha mask.', error);
      return null;
    });
    const cutoutData = segmentation || await createFallbackAlphaMask(imageData.buffer);
    const cutoutBuffer = await sharp(cutoutData.sourcePng)
      .removeAlpha()
      .joinChannel(cutoutData.mask)
      .png()
      .toBuffer();
    const maskImage = await writeProToolBuffer(payload.projectId, imageData.projectDir, 'pro-tools/masks', cutoutData.mask, `${imageData.fileName}-mask`, 'image/png', cutoutData.width, cutoutData.height);
    const cutoutImage = await writeProToolBuffer(payload.projectId, imageData.projectDir, 'pro-tools/cutouts', cutoutBuffer, `${imageData.fileName}-cutout`, 'image/png', cutoutData.width, cutoutData.height);
    return {
      image: cutoutImage,
      mask: maskImage,
      modelUsed: segmentation ? segmentation.modelId : 'local-edge-fallback',
      message: segmentation ? 'Background removed with the local Pro AI model.' : 'Background removed with the local fallback matte. Install the Pro AI model pack for stronger cutouts.',
    };
  });
}

async function finishLocalImage(payload: ProToolImagePayload) {
  return enqueueProTool(async () => {
    const imageData = await resolveImagePayload(payload.projectId, payload.image);
    const settings = payload.settings || {};
    const clampSigned = (value: unknown) => Math.max(-100, Math.min(100, Number(value ?? 0)));
    const sharpen = clampSigned(settings.sharpen);
    const denoise = clampSigned(settings.denoise);
    const clarity = clampSigned(settings.clarity);
    const brightness = clampSigned(settings.brightness);
    const saturation = clampSigned(settings.saturation);
    const upscale = Math.max(1, Math.min(2, Number(settings.upscale ?? 1)));
    const brightnessFactor = Math.max(0.35, 1 + brightness / 220);
    const saturationFactor = Math.max(0, 1 + saturation / 150);
    const contrastFactor = Math.max(0.35, 1 + clarity / 240);
    const contrastOffset = clarity > 0 ? -(clarity / 5) : Math.abs(clarity) / 8;

    let pipeline = sharp(imageData.buffer)
      .rotate()
      .resize({ width: Math.round(4096 * upscale), height: Math.round(4096 * upscale), fit: 'inside', withoutEnlargement: upscale <= 1, kernel: sharp.kernel.lanczos3 })
      .modulate({
        brightness: brightnessFactor,
        saturation: saturationFactor,
      })
      .linear(contrastFactor, contrastOffset);

    if (denoise < 0) {
      pipeline = pipeline.median(Math.max(1, Math.min(3, Math.round(Math.abs(denoise) / 34))));
    }
    if (denoise > 0) {
      pipeline = pipeline.sharpen({
        sigma: 0.65 + denoise / 115,
        m1: 0.55,
        m2: 1.25,
      });
    }
    if (sharpen > 0) {
      pipeline = pipeline.sharpen({
        sigma: 0.8 + sharpen / 75,
        m1: 0.8,
        m2: 1.8,
      });
    }
    if (sharpen < 0) {
      pipeline = pipeline.blur(Math.min(1.4, Math.abs(sharpen) / 80));
    }

    const output = await pipeline.png().toBuffer();
    const metadata = await sharp(output).metadata();
    const image = await writeProToolBuffer(payload.projectId, imageData.projectDir, 'pro-tools/finished', output, `${imageData.fileName}-finished`, 'image/png', metadata.width || imageData.width, metadata.height || imageData.height);
    return {
      image,
      settings: { sharpen, denoise, clarity, brightness, saturation, upscale },
      message: 'Finished locally and saved to the project.',
    };
  });
}

async function installProAiPack() {
  await fs.rm(PRO_AI_SETUP_TEMP, { recursive: true, force: true });
  await fs.mkdir(PRO_AI_SETUP_TEMP, { recursive: true });
  const headers = { 'User-Agent': 'ISTUDIO-Pro-AI-Installer' };
  const response = await fetch('https://api.github.com/repos/metadreamx/ISTUDIO/releases/latest', { headers });
  if (!response.ok) {
    throw new Error('Could not reach ISTUDIO releases to install the Pro AI Pack.');
  }
  const release = await response.json() as { assets?: Array<{ name: string; browser_download_url: string }> };
  const asset = (release.assets || []).find((item) => item.name === 'ISTUDIO-ProTools-windows.zip');
  if (!asset) {
    throw new Error('The Pro AI Pack is not published yet. Install it after the next ISTUDIO release includes ISTUDIO-ProTools-windows.zip.');
  }

  const zipPath = path.join(PRO_AI_SETUP_TEMP, 'ISTUDIO-ProTools-windows.zip');
  const zipResponse = await fetch(asset.browser_download_url, { headers });
  if (!zipResponse.ok || !zipResponse.body) {
    throw new Error('Could not download the Pro AI Pack.');
  }
  const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
  await fs.writeFile(zipPath, zipBuffer);

  const extractPath = path.join(PRO_AI_SETUP_TEMP, 'extract');
  await fs.mkdir(extractPath, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(extractPath)} -Force`,
    ], { windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Pro AI Pack extraction failed with code ${code}.`)));
  });

  const candidates = [
    extractPath,
    path.join(extractPath, 'ISTUDIO-ProTools'),
    path.join(extractPath, 'ISTUDIO'),
  ];
  const root = candidates.find((candidate) => existsSync(path.join(candidate, 'models', 'pro-ai')) || existsSync(path.join(candidate, 'runtime', 'pro-ai')));
  if (!root) {
    throw new Error('The downloaded Pro AI Pack is incomplete.');
  }
  if (existsSync(path.join(root, 'models', 'pro-ai'))) {
    await fs.mkdir(PRO_AI_MODELS_DIR, { recursive: true });
    await fs.cp(path.join(root, 'models', 'pro-ai'), PRO_AI_MODELS_DIR, { recursive: true, force: true });
  }
  if (existsSync(path.join(root, 'runtime', 'pro-ai'))) {
    await fs.mkdir(PRO_AI_RUNTIME_DIR, { recursive: true });
    await fs.cp(path.join(root, 'runtime', 'pro-ai'), PRO_AI_RUNTIME_DIR, { recursive: true, force: true });
  }
  await fs.rm(PRO_AI_SETUP_TEMP, { recursive: true, force: true });
  return getProToolStatus();
}

function tetherStatus(options: { includeImages?: boolean; knownCaptureIds?: Set<string> } = {}) {
  const includeImages = Boolean(options.includeImages);
  const knownCaptureIds = options.knownCaptureIds || new Set<string>();

  return {
    isWatching: Boolean(tetherWatcher && tetherSession),
    folderPath: tetherSession?.folderPath || null,
    projectId: tetherSession?.projectId || null,
    autoEdit: tetherSession?.autoEdit || false,
    startedAt: tetherSession?.startedAt || null,
    message: tetherMessage,
    captures: tetherCaptures.slice(0, 80).map((capture) => {
      if (!capture.image || !includeImages || knownCaptureIds.has(capture.id)) {
        const { image: _image, ...metadataOnlyCapture } = capture;
        return metadataOnlyCapture;
      }
      return capture;
    }),
    supportedExtensions: Array.from(TETHER_SUPPORTED_EXTENSIONS).map((extension) => extension.slice(1)),
    rawExtensions: Array.from(TETHER_RAW_EXTENSIONS).map((extension) => extension.slice(1)),
  };
}

function addTetherCapture(capture: TetherCapture) {
  tetherCaptures.unshift(capture);
  tetherCaptures.splice(120);
}

function tetherCaptureId(filePath: string, signature: string): string {
  return createHash('sha1').update(`${filePath}|${signature}`).digest('hex').slice(0, 16);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStableFile(filePath: string, maxChecks = 24, delayMs = 500) {
  let lastSize = -1;
  let stableChecks = 0;

  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    const stats = await fs.stat(filePath);
    if (stats.isFile() && stats.size > 0 && stats.size === lastSize) {
      stableChecks += 1;
      if (stableChecks >= 2) return stats;
    } else {
      stableChecks = 0;
      lastSize = stats.size;
    }
    await sleep(delayMs);
  }

  throw new Error('The capture did not finish writing in time.');
}

function safeTetherImportName(filePath: string, contentHash: string) {
  const extension = path.extname(filePath).toLowerCase();
  const baseName = safeFilePart(path.basename(filePath, extension));
  const hash = contentHash.slice(0, 10);
  return `${baseName}-${hash}${extension}`;
}

async function importTetherCapture(filePath: string) {
  const session = tetherSession;
  if (!session) return;

  const absolutePath = path.resolve(filePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const fileName = path.basename(absolutePath);
  const createdAt = Date.now();

  if (TETHER_RAW_EXTENSIONS.has(extension)) {
    addTetherCapture({
      id: tetherCaptureId(absolutePath, `${createdAt}`),
      fileName,
      sourcePath: absolutePath,
      projectId: session.projectId,
      status: 'ignored',
      message: 'RAW capture ignored. Save JPEG, PNG, WebP, or TIFF previews from your tether software for ISTUDIO import.',
      createdAt,
    });
    return;
  }

  if (!TETHER_SUPPORTED_EXTENSIONS.has(extension)) {
    return;
  }

  try {
    await waitForStableFile(absolutePath);
    const normalizedSourcePath = absolutePath.toLowerCase();

    if (isInsideDirectory(PROJECTS_DIR, absolutePath)) {
      return;
    }

    const sourceBuffer = await fs.readFile(absolutePath);
    const contentHash = createHash('sha1').update(sourceBuffer).digest('hex');
    const previousHashForSource = tetherSeenSourceHashes.get(normalizedSourcePath);
    if (previousHashForSource === contentHash || tetherSeenContentHashes.has(contentHash)) {
      return;
    }
    tetherSeenSourceHashes.set(normalizedSourcePath, contentHash);
    tetherSeenContentHashes.add(contentHash);

    const projectDir = await findProjectDir(session.projectId);
    if (!projectDir) {
      addTetherCapture({
        id: tetherCaptureId(absolutePath, contentHash),
        fileName,
        sourcePath: absolutePath,
        projectId: session.projectId,
        status: 'failed',
        message: 'The selected project could not be found. Stop tethering and choose a project again.',
        createdAt,
      });
      return;
    }

    const inboxDir = path.join(projectDir, 'tether', 'inbox');
    await fs.mkdir(inboxDir, { recursive: true });
    const targetPath = path.join(inboxDir, safeTetherImportName(absolutePath, contentHash));
    if (path.resolve(targetPath) !== absolutePath && !existsSync(targetPath)) {
      await fs.writeFile(targetPath, sourceBuffer);
    }

    const assetPath = relativeAssetPath(projectDir, targetPath);
    const capture: TetherCapture = {
      id: tetherCaptureId(absolutePath, contentHash),
      fileName,
      sourcePath: absolutePath,
      projectId: session.projectId,
      status: 'imported',
      message: 'Imported from watched capture folder.',
      createdAt,
      importedAt: Date.now(),
      image: {
        fileName,
        base64: null,
        mimeType: mimeTypeForExtension(targetPath),
        width: null,
        height: null,
        assetPath,
        assetUrl: assetUrlForProject(session.projectId, assetPath),
      },
    };
    addTetherCapture(capture);
    tetherMessage = `Imported ${fileName}.`;
  } catch (error) {
    addTetherCapture({
      id: tetherCaptureId(absolutePath, `${createdAt}`),
      fileName,
      sourcePath: absolutePath,
      projectId: session.projectId,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Capture import failed.',
      createdAt,
    });
  }
}

function scheduleTetherImport(filePath: string) {
  const absolutePath = path.resolve(filePath);
  const existingTimer = tetherImportTimers.get(absolutePath);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    tetherImportTimers.delete(absolutePath);
    importTetherCapture(absolutePath);
  }, 750);
  tetherImportTimers.set(absolutePath, timer);
}

async function stopTetherSession(message = 'Tethered capture stopped.') {
  for (const timer of tetherImportTimers.values()) {
    clearTimeout(timer);
  }
  tetherImportTimers.clear();

  if (tetherWatcher) {
    await tetherWatcher.close();
    tetherWatcher = null;
  }

  tetherSession = null;
  tetherMessage = message;
}

async function startTetherSession(folderPath: string, projectId: string, autoEdit: boolean) {
  const resolvedFolder = path.resolve(folderPath);
  const stats = await fs.stat(resolvedFolder).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error('Capture folder not found. Choose a folder that your camera software can write into.');
  }

  const projectDir = await findProjectDir(projectId);
  if (!projectDir) {
    throw new Error('Project not found. Create or open a Reference Edit project before starting Tethered Mode.');
  }
  if (isInsideDirectory(PROJECTS_DIR, resolvedFolder) || isInsideDirectory(projectDir, resolvedFolder)) {
    throw new Error('Choose a camera capture folder outside the ISTUDIO projects folder. This prevents imported files from being watched again.');
  }

  await ensureProjectAssetDirs(projectDir);
  const isDifferentSource = !tetherSession || tetherSession.folderPath !== resolvedFolder || tetherSession.projectId !== projectId;
  await stopTetherSession('Restarting tethered capture.');
  if (isDifferentSource) {
    tetherSeenSourceHashes.clear();
    tetherSeenContentHashes.clear();
  }
  tetherSession = {
    folderPath: resolvedFolder,
    projectId,
    autoEdit,
    startedAt: Date.now(),
  };
  tetherMessage = `Watching ${resolvedFolder}`;

  tetherWatcher = chokidar.watch(resolvedFolder, {
    awaitWriteFinish: {
      stabilityThreshold: 1500,
      pollInterval: 250,
    },
    ignoreInitial: true,
    depth: 0,
    persistent: true,
  });

  tetherWatcher
    .on('add', scheduleTetherImport)
    .on('change', scheduleTetherImport)
    .on('unlinkDir', async (folder) => {
      if (path.resolve(folder) === resolvedFolder) {
        await stopTetherSession('Capture folder was removed. Choose the folder again to resume tethering.');
      }
    })
    .on('error', (error) => {
      tetherMessage = error instanceof Error ? error.message : 'Tether watcher error.';
    });
}

function pickWindowsFolder(): Promise<string | null> {
  if (process.platform !== 'win32') {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const command = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = 'Select the folder where your camera tether software saves new photos.'",
      '$dialog.ShowNewFolderButton = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
    ].join('; ');
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: false,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && stderr.trim()) {
        reject(new Error(stderr.trim()));
        return;
      }
      resolve(stdout.trim() || null);
    });
  });
}

function normalizeGeminiRelayError(status: number, message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('service_disabled') || lower.includes('api has not been used') || (lower.includes('generative language api') && lower.includes('disabled'))) {
    return {
      errorCode: 'GEMINI_API_DISABLED',
      userMessage: 'The Gemini API is not enabled for this Google project. Enable the Gemini API for the key, then try Test Gemini again.',
    };
  }
  if (status === 401 || status === 403 || lower.includes('api key') || lower.includes('permission_denied') || lower.includes('forbidden')) {
    return {
      errorCode: 'GEMINI_KEY_REJECTED',
      userMessage: 'Gemini could not use this API key. Re-enter a valid Google Gemini API key and confirm the Gemini API is enabled for that Google project.',
    };
  }
  if (status === 404 || (lower.includes('model') && (lower.includes('not found') || lower.includes('not available') || lower.includes('unsupported')))) {
    return {
      errorCode: 'GEMINI_MODEL_UNAVAILABLE',
      userMessage: "Gemini's current model is unavailable for this API key. ISTUDIO will try the next supported model.",
    };
  }
  if (status === 429 || lower.includes('quota') || lower.includes('resource_exhausted') || lower.includes('spending cap')) {
    return {
      errorCode: 'GEMINI_QUOTA',
      userMessage: 'Gemini reached the quota or billing limit for this API key. Check your Google AI billing and quota settings.',
    };
  }
  if (status >= 500 || lower.includes('overloaded') || lower.includes('unavailable')) {
    return {
      errorCode: 'GEMINI_TEMPORARY_FAILURE',
      userMessage: 'Gemini is temporarily overloaded. ISTUDIO will retry automatically.',
    };
  }
  return {
    errorCode: 'GEMINI_REQUEST_FAILED',
    userMessage: message || 'Gemini request failed.',
  };
}

function normalizeGeminiRelayPayload(payload: GeminiRelayPayload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Gemini request payload is required.');
  }
  if (!payload.model || typeof payload.model !== 'string') {
    throw new Error('Gemini model is required.');
  }
  if (!payload.contents || typeof payload.contents !== 'object') {
    throw new Error('Gemini contents are required.');
  }

  const body: Record<string, unknown> = {
    contents: [payload.contents],
  };
  if (payload.config && typeof payload.config === 'object') {
    body.generationConfig = payload.config;
  }
  return body;
}

async function proxyGeminiGenerate(payload: GeminiRelayPayload, apiKey: string) {
  const requestBody = normalizeGeminiRelayPayload(payload);
  const payloadBytes = Buffer.byteLength(JSON.stringify(requestBody), 'utf8');
  if (payloadBytes > GEMINI_RELAY_MAX_BYTES) {
    return {
      status: 413,
      body: {
        ok: false,
        errorCode: 'GEMINI_PAYLOAD_TOO_LARGE',
        userMessage: 'This Gemini request is too large. Use fewer assets or smaller batch images, then try again.',
        rawStatus: 413,
      },
    };
  }

  const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(payload.model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const rawMessage = String((json?.error as { message?: string } | undefined)?.message || response.statusText || 'Gemini request failed.');
    const normalized = normalizeGeminiRelayError(response.status, rawMessage);
    return {
      status: response.status,
      body: {
        ok: false,
        ...normalized,
        rawStatus: response.status,
        rawMessage,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      modelUsed: payload.model,
      response: json,
    },
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: PROJECT_PAYLOAD_LIMIT }));
  const jsonPayloadErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === 'entity.too.large' || error?.status === 413) {
      res.status(413).json({
        error: `This project update is larger than ISTUDIO can safely save at once (${PROJECT_PAYLOAD_LIMIT}). Images should save into the project folder one at a time; restart ISTUDIO and try the upload again.`,
      });
      return;
    }
    next(error);
  };
  app.use(jsonPayloadErrorHandler);
  await ensureProjectsDir();
  await migrateLegacyProjectFiles();

  app.post('/api/gemini/generate', async (req, res) => {
    try {
      const apiKey = String(req.header(GEMINI_RELAY_HEADER) || '').trim();
      if (!apiKey) {
        res.status(401).json({
          ok: false,
          errorCode: 'GEMINI_KEY_MISSING',
          userMessage: 'Add your Google Gemini API key in ISTUDIO Settings before analyzing or generating.',
          rawStatus: 401,
        });
        return;
      }

      const result = await proxyGeminiGenerate(req.body as GeminiRelayPayload, apiKey);
      res.status(result.status).json(result.body);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Gemini relay failed.';
      const normalized = normalizeGeminiRelayError(500, rawMessage);
      res.status(500).json({
        ok: false,
        ...normalized,
        rawStatus: 500,
        rawMessage,
      });
    }
  });

  app.post('/api/color-grade/analyze', async (req, res) => {
    try {
      const payload = req.body as ColorGradeRenderPayload;
      if (!payload?.projectId || !payload.target) {
        res.status(400).json({ error: 'Choose a target photo before running Master Match.' });
        return;
      }
      const [target, reference] = await Promise.all([
        analyzeColorGradeImage(payload.projectId, payload.target),
        payload.reference ? analyzeColorGradeImage(payload.projectId, payload.reference) : Promise.resolve(null),
      ]);
      res.json({
        engineVersion: payload.recipe?.version || '2.0.0',
        target,
        reference,
      });
    } catch (error) {
      console.error('Color Grade analysis failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Master Match analysis failed.' });
    }
  });

  app.post('/api/color-grade/render', async (req, res) => {
    try {
      const payload = req.body as ColorGradeRenderPayload;
      if (!payload?.projectId || !payload.target || !payload.recipe) {
        res.status(400).json({ error: 'The Master Match render request is incomplete.' });
        return;
      }
      res.json(await renderColorGradeImage(payload));
    } catch (error) {
      console.error('Color Grade render failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Full-resolution Master Match render failed.' });
    }
  });

  app.get('/api/projects', async (req, res) => {
    try {
      const wantsFullProjects = req.query.full === '1' || req.query.includeImages === '1';
      res.json(wantsFullProjects ? await readProjects() : await readProjectSummaries());
    } catch (error) {
      console.error('Failed to read projects folder', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read projects folder.' });
    }
  });

  app.get('/api/projects/:id', async (req, res) => {
    try {
      const projectDir = await findProjectDir(req.params.id);
      if (!projectDir) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const project = await readProjectFromDirectory(projectDir);
      if (!project) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      res.json(project);
    } catch (error) {
      console.error('Failed to read project folder', error);
      res.status(500).json({ error: 'Failed to read project folder.' });
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/assets\/(.+)$/, async (req, res) => {
    try {
      const params = req.params as unknown as Record<string, string>;
      const projectId = decodeURIComponent(params[0] || '');
      const requestedPath = decodeURIComponent(params[1] || '').replace(/\\/g, '/');
      const projectDir = await findProjectDir(projectId);
      if (!projectDir) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const assetPath = await resolvePortableProjectAsset(projectDir, requestedPath);
      if (!assetPath || !isInsideDirectory(projectDir, assetPath)) {
        res.status(404).json({ error: 'Project asset not found.' });
        return;
      }

      res.type(mimeTypeForExtension(assetPath));
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.sendFile(assetPath);
    } catch (error) {
      console.error('Failed to read project asset', error);
      res.status(500).json({ error: 'Failed to read project asset.' });
    }
  });

  app.post('/api/projects/:id/assets', async (req, res) => {
    try {
      res.json(await writeImageAsset(req.params.id, req.body as ImageAssetPayload));
    } catch (error) {
      console.error('Failed to save project asset', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save project asset.' });
    }
  });

  app.put('/api/projects/:id', async (req, res) => {
    try {
      const project = req.body as StoredProject;
      if (!project || typeof project.id !== 'string' || project.id !== req.params.id) {
        res.status(400).json({ error: 'Invalid project payload.' });
        return;
      }
      await writeProject(project);
      res.json({ ok: true });
    } catch (error) {
      console.error('Failed to save project folder', error);
      res.status(500).json({ error: 'Failed to save project folder.' });
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      await deleteProjectFolder(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      console.error('Failed to delete project folder', error);
      res.status(500).json({ error: 'Failed to delete project folder.' });
    }
  });

  app.get('/api/projects-folder', async (_req, res) => {
    try {
      await ensureProjectsDir();
      const projects = await projectDirectories();
      res.json({
        path: PROJECTS_DIR,
        projectCount: projects.length,
        mode: 'folder',
      });
    } catch (error) {
      console.error('Failed to inspect projects folder', error);
      res.status(500).json({ error: 'Failed to inspect projects folder.' });
    }
  });

  app.post('/api/projects-folder/open', async (_req, res) => {
    try {
      await ensureProjectsDir();
      const child = openFolder(PROJECTS_DIR);
      child.unref();
      res.json({ ok: true, path: PROJECTS_DIR });
    } catch (error) {
      console.error('Failed to open projects folder', error);
      res.status(500).json({ error: 'Failed to open projects folder.' });
    }
  });

  app.get('/api/tether/status', (req, res) => {
    const knownCaptureIds = new Set(
      typeof req.query.known === 'string'
        ? req.query.known.split(',').map((id) => id.trim()).filter(Boolean)
        : [],
    );
    res.json(tetherStatus({
      includeImages: req.query.includeImages === '1',
      knownCaptureIds,
    }));
  });

  app.post('/api/tether/folder-picker', async (_req, res) => {
    try {
      const folderPath = await pickWindowsFolder();
      res.json({ path: folderPath });
    } catch (error) {
      console.error('Failed to open tether folder picker', error);
      res.status(500).json({ error: 'Could not open the folder picker. Paste the folder path manually.' });
    }
  });

  app.post('/api/tether/start', async (req, res) => {
    try {
      const folderPath = typeof req.body?.folderPath === 'string' ? req.body.folderPath.trim() : '';
      const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
      const autoEdit = Boolean(req.body?.autoEdit);

      if (!folderPath || !projectId) {
        res.status(400).json({ error: 'Choose a capture folder and project before starting Tethered Mode.' });
        return;
      }

      await startTetherSession(folderPath, projectId, autoEdit);
      res.json(tetherStatus());
    } catch (error) {
      console.error('Failed to start tethered capture', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to start Tethered Mode.',
      });
    }
  });

  app.post('/api/tether/stop', async (_req, res) => {
    try {
      await stopTetherSession();
      res.json(tetherStatus());
    } catch (error) {
      console.error('Failed to stop tethered capture', error);
      res.status(500).json({ error: 'Failed to stop Tethered Mode.' });
    }
  });

  app.post('/api/virtual-set/render', async (req, res) => {
    try {
      const payload = req.body as VirtualSetRenderPayload;
      if (!payload?.projectId || !payload.dataUrl) {
        res.status(400).json({ error: 'Project ID and render data are required.' });
        return;
      }
      res.json(await writeVirtualSetRender(payload));
    } catch (error) {
      console.error('Failed to save Virtual Set render', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save Virtual Set render.' });
    }
  });

  app.post('/api/virtual-set/use-as-reference', async (req, res) => {
    try {
      const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
      const image = req.body?.image as StoredImageState | undefined;
      if (!projectId || !image?.mimeType || (!image.base64 && !image.assetPath)) {
        res.status(400).json({ error: 'Project ID and rendered image are required.' });
        return;
      }
      res.json(await useVirtualSetRenderAsReference(projectId, image));
    } catch (error) {
      console.error('Failed to use Virtual Set render as reference', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to use render as reference.' });
    }
  });

  app.get('/api/pro-tools/status', async (_req, res) => {
    try {
      res.json(await getProToolStatus());
    } catch (error) {
      console.error('Failed to inspect Pro AI tools', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to inspect Pro AI tools.' });
    }
  });

  app.post('/api/pro-tools/install', async (_req, res) => {
    try {
      res.json(await installProAiPack());
    } catch (error) {
      await fs.rm(PRO_AI_SETUP_TEMP, { recursive: true, force: true }).catch(() => undefined);
      console.error('Failed to install Pro AI Pack', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to install Pro AI Pack.' });
    }
  });

  app.post('/api/pro-tools/cull', async (req, res) => {
    try {
      res.json(await analyzeLocalImage(req.body as ProToolImagePayload));
    } catch (error) {
      console.error('Failed to analyze image with Pro Tools', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to analyze image.' });
    }
  });

  app.post('/api/pro-tools/background-cutout', async (req, res) => {
    try {
      res.json(await removeLocalBackground(req.body as ProToolImagePayload));
    } catch (error) {
      console.error('Failed to remove background with Pro Tools', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to remove background.' });
    }
  });

  app.post('/api/pro-tools/finish', async (req, res) => {
    try {
      res.json(await finishLocalImage(req.body as ProToolImagePayload));
    } catch (error) {
      console.error('Failed to finish image with Pro Tools', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to finish image.' });
    }
  });

  app.all('/api/*path', (_req, res) => {
    res.status(404).json({ error: 'ISTUDIO project API route not found.' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Close the old ISTUDIO launcher window, then run LAUNCH.bat again.`);
    } else {
      console.error('Failed to start ISTUDIO server', error);
    }
    process.exit(1);
  });
}

startServer();
