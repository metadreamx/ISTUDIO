import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECTS_DIR = path.resolve(process.env.ISTUDIO_PROJECTS_DIR || path.join(process.cwd(), 'projects'));
const PROJECT_JSON = 'project.json';

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
  assetPath?: string;
};

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
  return 'bin';
}

function assetBucketForPath(segments: string[]): string {
  if (segments.includes('generationHistory')) {
    if (segments.at(-1) === 'generated') return 'outputs';
    if (segments.at(-1) === 'target') return 'targets';
    if (segments.at(-1) === 'reference') return 'reference';
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

async function ensureProjectsDir() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
}

async function ensureProjectAssetDirs(projectDir: string) {
  await Promise.all([
    fs.mkdir(path.join(projectDir, 'reference'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'targets'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'outputs'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'assets'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'originals'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'layers'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'exports'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'masks'), { recursive: true }),
    fs.mkdir(path.join(projectDir, 'editor', 'assets'), { recursive: true }),
  ]);
}

async function projectDirectories(): Promise<string[]> {
  await ensureProjectsDir();
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PROJECTS_DIR, entry.name));
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
    const raw = await fs.readFile(filePath, 'utf8');
    const project = JSON.parse(raw) as StoredProject;
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
    const assetPath = resolveProjectPath(projectDir, value.path);
    const base64 = await fs.readFile(assetPath, 'base64');
    return `data:${value.mimeType};base64,${base64}`;
  }

  if (isImageState(value)) {
    if (value.assetPath && value.mimeType) {
      const assetPath = resolveProjectPath(projectDir, value.assetPath);
      const base64 = await fs.readFile(assetPath, 'base64');
      const { assetPath: _assetPath, ...imageState } = value;
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
  if (!project) return null;

  try {
    return await hydrateValue(project, projectDir) as StoredProject;
  } catch (error) {
    console.warn(`Skipping project with missing or invalid assets: ${projectPath}`, error);
    return null;
  }
}

async function readProjects(): Promise<StoredProject[]> {
  await migrateLegacyProjectFiles();
  const directories = await projectDirectories();
  const projects = await Promise.all(directories.map(readProjectFromDirectory));
  return projects
    .filter((project): project is StoredProject => project !== null)
    .sort((a, b) => b.lastModified - a.lastModified);
}

async function findProjectDir(id: string): Promise<string | null> {
  const directories = await projectDirectories();
  for (const projectDir of directories) {
    const project = await readRawProjectFile(path.join(projectDir, PROJECT_JSON));
    if (project?.id === id) return projectDir;
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
  await fs.writeFile(targetPath, Buffer.from(value.base64, 'base64'));

  return {
    fileName: value.fileName,
    base64: null,
    mimeType: value.mimeType,
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
  await fs.writeFile(targetPath, Buffer.from(parsed.base64, 'base64'));

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
  const targetDir = path.join(PROJECTS_DIR, `${safeFilePart(project.name)}-${project.id}`);
  const tempPath = path.join(targetDir, `${PROJECT_JSON}.tmp`);
  const projectPath = path.join(targetDir, PROJECT_JSON);

  await fs.mkdir(targetDir, { recursive: true });
  await ensureProjectAssetDirs(targetDir);

  const storedProject = await persistValue(project, targetDir) as StoredProject;
  await fs.writeFile(tempPath, JSON.stringify(storedProject, null, 2), 'utf8');
  await fs.rename(tempPath, projectPath);

  if (existingDir && existingDir !== targetDir && existsSync(existingDir)) {
    await fs.rm(existingDir, { recursive: true, force: true });
  }
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
    const project = await readRawProjectFile(filePath);
    if (!project) continue;
    await writeProject(project);
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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '250mb' }));
  await ensureProjectsDir();
  await migrateLegacyProjectFiles();

  app.get('/api/projects', async (_req, res) => {
    try {
      res.json(await readProjects());
    } catch (error) {
      console.error('Failed to read projects folder', error);
      res.status(500).json({ error: 'Failed to read projects folder.' });
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
      const projects = await readProjects();
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
      console.error(`Port ${PORT} is already in use. Close the old ISTUDIO launcher window, then run ISTUDIO.bat again.`);
    } else {
      console.error('Failed to start ISTUDIO server', error);
    }
    process.exit(1);
  });
}

startServer();
