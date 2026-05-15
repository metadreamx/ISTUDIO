import express, { type ErrorRequestHandler } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import chokidar, { type FSWatcher } from 'chokidar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECTS_DIR = path.resolve(process.env.ISTUDIO_PROJECTS_DIR || path.join(process.cwd(), 'projects'));
const PROJECT_JSON = 'project.json';
const PROJECT_PAYLOAD_LIMIT = process.env.ISTUDIO_PROJECT_PAYLOAD_LIMIT || '2gb';
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

async function hydrateValue(value: unknown, projectDir: string): Promise<unknown> {
  if (typeof value === 'string') {
    return value;
  }

  if (isStoredAssetReference(value)) {
    const assetPath = await resolvePortableProjectAsset(projectDir, value.path);
    if (!assetPath) {
      console.warn(`Missing imported project asset: ${path.join(projectDir, value.path)}`);
      return '';
    }
    const base64 = await fs.readFile(assetPath, 'base64');
    return `data:${value.mimeType};base64,${base64}`;
  }

  if (isImageState(value)) {
    if (value.assetPath && value.mimeType) {
      const assetPath = await resolvePortableProjectAsset(projectDir, value.assetPath);
      const { assetPath: _assetPath, ...imageState } = value;
      if (!assetPath) {
        console.warn(`Missing imported project image: ${path.join(projectDir, value.assetPath)}`);
        return { ...imageState, base64: null };
      }
      const base64 = await fs.readFile(assetPath, 'base64');
      return { ...imageState, base64 };
    }
    return value;
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => hydrateValue(item, projectDir)));
  }

  if (isRecord(value)) {
    const hydratedEntries = await Promise.all(
      Object.entries(value).map(async ([key, entryValue]) => [key, await hydrateValue(entryValue, projectDir)]),
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
    return importedProject ? await hydrateValue(importedProject, projectDir) as StoredProject : null;
  }

  try {
    return await hydrateValue(project, projectDir) as StoredProject;
  } catch (error) {
    console.warn(`Recovering project with missing or invalid data: ${projectPath}`, error);
    const importedProject = await safeReadImportedProjectFromFiles(projectDir);
    if (importedProject) {
      try {
        return await hydrateValue(importedProject, projectDir) as StoredProject;
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
      outputCount: Math.max(history.length, generatedImages.length, targetImages.length),
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
  if (!value.base64 || !value.mimeType) return value;

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

    const base64 = sourceBuffer.toString('base64');
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
        base64,
        mimeType: mimeTypeForExtension(targetPath),
        width: null,
        height: null,
        assetPath: relativeAssetPath(projectDir, targetPath),
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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: PROJECT_PAYLOAD_LIMIT }));
  const jsonPayloadErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === 'entity.too.large' || error?.status === 413) {
      res.status(413).json({
        error: `Project save is too large for the local server limit (${PROJECT_PAYLOAD_LIMIT}). Reduce the batch size or raise ISTUDIO_PROJECT_PAYLOAD_LIMIT.`,
      });
      return;
    }
    next(error);
  };
  app.use(jsonPayloadErrorHandler);
  await ensureProjectsDir();
  await migrateLegacyProjectFiles();

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
