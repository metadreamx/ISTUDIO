import JSZip from 'jszip';
import type { HistoryItem, ImageState, Project, ProjectStorageMode, TetherStatus } from '../types';

const DB_NAME = 'StyleTransferDB';
const DB_VERSION = 4;
const STORE_NAME = 'history';
const PROJECTS_STORE = 'projects';
const ASSETS_STORE = 'projectAssets';
const PROJECTS_API = '/api/projects';
const PROJECTS_FOLDER_API = '/api/projects-folder';
const TETHER_API = '/api/tether';
const VIRTUAL_SET_API = '/api/virtual-set';
const MOBILE_ASSET_SCHEME = 'istudio-idb://';

interface BrowserProjectAsset {
    id: string;
    projectId: string;
    bucket: string;
    fileName: string | null;
    mimeType: string;
    width: number | null;
    height: number | null;
    blob: Blob;
    createdAt: number;
}

const objectUrlToAssetPath = new Map<string, string>();
const assetPathToObjectUrl = new Map<string, string>();

function isMobileLikeDevice(): boolean {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function isLoopbackHost(hostname: string): boolean {
    return ['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase());
}

export function getRuntimeStorageMode(): ProjectStorageMode {
    const override = new URLSearchParams(window.location.search).get('storage');
    if (override === 'browser') return 'browser';
    if (override === 'folder') return 'folder';

    const isLocalServer = isLoopbackHost(window.location.hostname);
    if (isLocalServer || window.location.protocol === 'file:') return 'folder';
    return 'browser';
}

export function isBrowserProjectStorage(): boolean {
    return getRuntimeStorageMode() === 'browser' || isMobileLikeDevice();
}

function createAssetPath(projectId: string, assetId: string): string {
    return `${MOBILE_ASSET_SCHEME}${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`;
}

function parseAssetPath(assetPath: string): { projectId: string; assetId: string } | null {
    if (!assetPath.startsWith(MOBILE_ASSET_SCHEME)) return null;
    const rest = assetPath.slice(MOBILE_ASSET_SCHEME.length);
    const [projectId, assetId] = rest.split('/').map((part) => decodeURIComponent(part || ''));
    if (!projectId || !assetId) return null;
    return { projectId, assetId };
}

function isDataImage(value: string): boolean {
    return /^data:image\/[^;]+;base64,/.test(value);
}

function dataUrlToBlob(dataUrl: string): Blob {
    const [header, data] = dataUrl.split(',');
    const mimeType = header.match(/^data:([^;]+);/)?.[1] || 'application/octet-stream';
    const binary = atob(data || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
}

function imageStateLooksLikeImage(value: unknown): value is ImageState {
    if (!value || typeof value !== 'object') return false;
    const image = value as Partial<ImageState>;
    return 'base64' in image && 'mimeType' in image && ('fileName' in image || 'assetPath' in image || 'assetUrl' in image);
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        console.error('IndexedDB error:', request.error);
        reject('Error opening IndexedDB.');
      };
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('projectId', 'projectId', { unique: false });
        } else {
            const store = (event.target as IDBOpenDBRequest).transaction!.objectStore(STORE_NAME);
            if (!store.indexNames.contains('projectId')) {
                store.createIndex('projectId', 'projectId', { unique: false });
            }
        }
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
            db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(ASSETS_STORE)) {
            const assetStore = db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
            assetStore.createIndex('projectId', 'projectId', { unique: false });
        } else {
            const assetStore = (event.target as IDBOpenDBRequest).transaction!.objectStore(ASSETS_STORE);
            if (!assetStore.indexNames.contains('projectId')) {
                assetStore.createIndex('projectId', 'projectId', { unique: false });
            }
        }
      };
    });
  }
  return dbPromise;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

async function apiRequest<T>(url: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...init,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                ...(init?.headers || {}),
            },
        });
        if (!response.ok) {
            let message = `Request failed with status ${response.status}`;
            try {
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const body = await response.json() as { error?: string; message?: string };
                    message = body.error || body.message || message;
                } else {
                    const bodyText = await response.text();
                    message = bodyText || message;
                }
            } catch {
                // Keep the status-only message if the server response cannot be parsed.
            }
            throw new Error(message);
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('Project storage is unavailable. Reopen ISTUDIO and try again.');
        }
        return await response.json() as T;
    } finally {
        window.clearTimeout(timeout);
    }
}

async function putBrowserAsset(input: {
    projectId: string;
    bucket: string;
    fileName: string | null;
    mimeType: string;
    width?: number | null;
    height?: number | null;
    blob: Blob;
    assetId?: string;
}): Promise<{ asset: BrowserProjectAsset; assetPath: string; assetUrl: string }> {
    const db = await getDB();
    const asset: BrowserProjectAsset = {
        id: input.assetId || `asset-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        projectId: input.projectId,
        bucket: input.bucket,
        fileName: input.fileName,
        mimeType: input.mimeType || input.blob.type || 'image/png',
        width: input.width ?? null,
        height: input.height ?? null,
        blob: input.blob,
        createdAt: Date.now(),
    };
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    tx.objectStore(ASSETS_STORE).put(asset);
    await promisifyTransaction(tx);

    const assetPath = createAssetPath(input.projectId, asset.id);
    const assetUrl = URL.createObjectURL(asset.blob);
    assetPathToObjectUrl.set(assetPath, assetUrl);
    objectUrlToAssetPath.set(assetUrl, assetPath);
    return { asset, assetPath, assetUrl };
}

async function getBrowserAsset(assetPath: string): Promise<BrowserProjectAsset | null> {
    const parsed = parseAssetPath(assetPath);
    if (!parsed) return null;
    const db = await getDB();
    const tx = db.transaction(ASSETS_STORE, 'readonly');
    const asset = await promisifyRequest(tx.objectStore(ASSETS_STORE).get(parsed.assetId));
    return asset || null;
}

async function getBrowserAssetsForProject(projectId: string): Promise<BrowserProjectAsset[]> {
    const db = await getDB();
    const tx = db.transaction(ASSETS_STORE, 'readonly');
    const store = tx.objectStore(ASSETS_STORE);
    const index = store.index('projectId');
    return await promisifyRequest(index.getAll(projectId));
}

async function hydrateAssetUrl(assetPath: string): Promise<string> {
    const cached = assetPathToObjectUrl.get(assetPath);
    if (cached) return cached;
    const asset = await getBrowserAsset(assetPath);
    if (!asset) return assetPath;
    const assetUrl = URL.createObjectURL(asset.blob);
    assetPathToObjectUrl.set(assetPath, assetUrl);
    objectUrlToAssetPath.set(assetUrl, assetPath);
    return assetUrl;
}

async function saveBrowserImageAsset(projectId: string, image: ImageState, bucket: string): Promise<ImageState> {
    if (image.assetPath?.startsWith(MOBILE_ASSET_SCHEME)) {
        return {
            ...image,
            assetUrl: image.assetUrl || await hydrateAssetUrl(image.assetPath),
            base64: null,
        };
    }

    const mappedPath = image.assetUrl ? objectUrlToAssetPath.get(image.assetUrl) : null;
    if (mappedPath) {
        return {
            ...image,
            assetPath: mappedPath,
            assetUrl: image.assetUrl || await hydrateAssetUrl(mappedPath),
            base64: null,
        };
    }

    let blob: Blob | null = null;
    let mimeType = image.mimeType || 'image/png';

    if (image.base64 && image.mimeType) {
        blob = dataUrlToBlob(`data:${image.mimeType};base64,${image.base64}`);
        mimeType = image.mimeType;
    } else if (image.assetUrl) {
        const response = await fetch(image.assetUrl);
        if (response.ok) {
            blob = await response.blob();
            mimeType = image.mimeType || blob.type || mimeType;
        }
    }

    if (!blob) return image;

    const { assetPath, assetUrl } = await putBrowserAsset({
        projectId,
        bucket,
        fileName: image.fileName,
        mimeType,
        width: image.width ?? null,
        height: image.height ?? null,
        blob,
    });

    return {
        ...image,
        base64: null,
        mimeType,
        assetPath,
        assetUrl,
    };
}

async function saveDataUrlAsBrowserAsset(projectId: string, dataUrl: string, bucket: string, fileName: string): Promise<string> {
    const blob = dataUrlToBlob(dataUrl);
    const { assetPath } = await putBrowserAsset({
        projectId,
        bucket,
        fileName,
        mimeType: blob.type || 'image/png',
        blob,
    });
    return assetPath;
}

function bucketForImageKey(key: string | null): 'reference' | 'targets' | 'outputs' | 'assets' | 'tether/inbox' {
    if (!key) return 'assets';
    if (key.toLowerCase().includes('reference')) return 'reference';
    if (key.toLowerCase().includes('target')) return 'targets';
    if (key.toLowerCase().includes('generated') || key.toLowerCase().includes('output')) return 'outputs';
    if (key.toLowerCase().includes('tether')) return 'tether/inbox';
    return 'assets';
}

async function dehydrateForBrowserStorage(value: unknown, projectId: string, key: string | null = null): Promise<unknown> {
    if (!value) return value;

    if (typeof value === 'string') {
        if (objectUrlToAssetPath.has(value)) return objectUrlToAssetPath.get(value)!;
        if (isDataImage(value)) {
            return await saveDataUrlAsBrowserAsset(projectId, value, bucketForImageKey(key), `${key || 'image'}-${Date.now()}.png`);
        }
        return value;
    }

    if (Array.isArray(value)) {
        const next = [];
        for (let index = 0; index < value.length; index += 1) {
            next.push(await dehydrateForBrowserStorage(value[index], projectId, key));
        }
        return next;
    }

    if (typeof value === 'object') {
        if (value instanceof Blob || value instanceof File) return value;

        if (imageStateLooksLikeImage(value)) {
            const image = await saveBrowserImageAsset(projectId, value, bucketForImageKey(key));
            return {
                ...image,
                assetUrl: image.assetPath?.startsWith(MOBILE_ASSET_SCHEME) ? null : image.assetUrl ?? null,
                base64: null,
            };
        }

        const record: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
            record[childKey] = await dehydrateForBrowserStorage(childValue, projectId, childKey);
        }
        return record;
    }

    return value;
}

async function hydrateBrowserProjectValue(value: unknown): Promise<unknown> {
    if (!value) return value;

    if (typeof value === 'string') {
        if (value.startsWith(MOBILE_ASSET_SCHEME)) {
            return await hydrateAssetUrl(value);
        }
        return value;
    }

    if (Array.isArray(value)) {
        const next = [];
        for (const child of value) {
            next.push(await hydrateBrowserProjectValue(child));
        }
        return next;
    }

    if (typeof value === 'object') {
        if (imageStateLooksLikeImage(value)) {
            const image = { ...(value as ImageState) };
            if (image.assetPath?.startsWith(MOBILE_ASSET_SCHEME)) {
                image.assetUrl = await hydrateAssetUrl(image.assetPath);
                image.base64 = null;
            }
            return image;
        }

        const record: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
            record[childKey] = await hydrateBrowserProjectValue(childValue);
        }
        return record;
    }

    return value;
}

async function saveBrowserProject(project: Project): Promise<void> {
    const prepared = await dehydrateForBrowserStorage(project, project.id) as Project;
    const db = await getDB();
    const tx = db.transaction(PROJECTS_STORE, 'readwrite');
    tx.objectStore(PROJECTS_STORE).put(prepared);
    await promisifyTransaction(tx);
}

async function hydrateBrowserProject(project: Project): Promise<Project> {
    return await hydrateBrowserProjectValue(project) as Project;
}

function summarizeBrowserProject(project: Project): Project {
    const outputCount = Array.isArray(project.state?.generationHistory)
        ? project.state.generationHistory.length
        : project.generatedImages?.length || 0;
    const virtualSetSceneCount = Array.isArray(project.state?.virtualSet?.scenes)
        ? project.state.virtualSet.scenes.length
        : 0;
    return {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        lastModified: project.lastModified,
        generatedImages: (project.generatedImages || []).slice(0, 4),
        state: {
            generationHistory: Array.isArray(project.state?.generationHistory)
                ? project.state.generationHistory.slice(0, 4)
                : [],
            virtualSet: { scenes: new Array(virtualSetSceneCount).fill(null) },
        },
        summary: {
            isSummary: true,
            outputCount,
            virtualSetSceneCount,
        },
    };
}

export async function addHistoryItem(item: HistoryItem): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(item);
  await promisifyTransaction(tx);
}

export async function getHistory(): Promise<HistoryItem[]> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const items = await promisifyRequest(tx.objectStore(STORE_NAME).getAll());
  // Sort descending by ID (newest first)
  return items.sort((a, b) => b.id - a.id);
}

export async function clearHistory(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  await promisifyTransaction(tx);
}

export async function deleteHistoryItems(ids: number[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    ids.forEach(id => store.delete(id));
    await promisifyTransaction(tx);
}

export async function saveProject(project: Project): Promise<void> {
    if (isBrowserProjectStorage()) {
        await saveBrowserProject(project);
        return;
    }

    await apiRequest<{ ok: boolean }>(`${PROJECTS_API}/${encodeURIComponent(project.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...project, summary: undefined }),
    }, 120000);
}

export async function saveProjectAsset(
    projectId: string,
    image: ImageState,
    bucket: 'reference' | 'targets' | 'outputs' | 'assets' | 'tether/inbox' = 'assets',
): Promise<ImageState> {
    if (isBrowserProjectStorage()) {
        return await saveBrowserImageAsset(projectId, image, bucket);
    }

    return await apiRequest<ImageState>(`${PROJECTS_API}/${encodeURIComponent(projectId)}/assets`, {
        method: 'POST',
        body: JSON.stringify({
            bucket,
            image,
            fileName: image.fileName,
            mimeType: image.mimeType,
            width: image.width ?? null,
            height: image.height ?? null,
        }),
    }, 120000);
}

export async function getProjects(): Promise<Project[]> {
    if (isBrowserProjectStorage()) {
        const indexedProjects = await getIndexedDbProjects();
        const hydrated = await Promise.all(indexedProjects.map(hydrateBrowserProject));
        return hydrated.map(summarizeBrowserProject);
    }

    const serverProjects = await apiRequest<Project[]>(`${PROJECTS_API}?summary=1`);
    await migrateIndexedDbProjectsToFolder(serverProjects);
    return await apiRequest<Project[]>(`${PROJECTS_API}?summary=1`);
}

export async function getProject(id: string): Promise<Project> {
    if (isBrowserProjectStorage()) {
        const db = await getDB();
        const tx = db.transaction(PROJECTS_STORE, 'readonly');
        const project = await promisifyRequest(tx.objectStore(PROJECTS_STORE).get(id));
        if (!project) throw new Error('Project not found on this device.');
        return await hydrateBrowserProject(project);
    }

    return await apiRequest<Project>(`${PROJECTS_API}/${encodeURIComponent(id)}`);
}

export async function deleteProject(id: string): Promise<void> {
    if (isBrowserProjectStorage()) {
        const db = await getDB();
        const projectTx = db.transaction(PROJECTS_STORE, 'readwrite');
        projectTx.objectStore(PROJECTS_STORE).delete(id);
        await promisifyTransaction(projectTx);

        const assets = await getBrowserAssetsForProject(id);
        const assetTx = db.transaction(ASSETS_STORE, 'readwrite');
        for (const asset of assets) {
            const assetPath = createAssetPath(id, asset.id);
            const objectUrl = assetPathToObjectUrl.get(assetPath);
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                objectUrlToAssetPath.delete(objectUrl);
                assetPathToObjectUrl.delete(assetPath);
            }
            assetTx.objectStore(ASSETS_STORE).delete(asset.id);
        }
        await promisifyTransaction(assetTx);
        return;
    }

    await apiRequest<{ ok: boolean }>(`${PROJECTS_API}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });

    try {
        const db = await getDB();
        
        // Delete history items for this project
        const historyTx = db.transaction(STORE_NAME, 'readwrite');
        const historyStore = historyTx.objectStore(STORE_NAME);
        const index = historyStore.index('projectId');
        const historyKeys = await promisifyRequest(index.getAllKeys(id));
        historyKeys.forEach(key => historyStore.delete(key));
        await promisifyTransaction(historyTx);

        // Remove any legacy browser copy left over from older versions.
        await deleteIndexedDbProjectOnly(id);
    } catch (error) {
        console.warn('Could not clean legacy browser data for deleted project.', error);
    }
}

export interface ProjectStorageInfo {
    path: string;
    projectCount: number;
    mode: ProjectStorageMode;
}

export async function getProjectStorageInfo(): Promise<ProjectStorageInfo> {
    if (isBrowserProjectStorage()) {
        const projects = await getIndexedDbProjects();
        return {
            path: 'Saved on this device. Use Export Backup to move projects.',
            projectCount: projects.length,
            mode: 'browser',
        };
    }

    const info = await apiRequest<{ path: string; projectCount: number; mode: 'folder' }>(PROJECTS_FOLDER_API);
    return {
        ...info,
        mode: 'folder',
    };
}

export async function openProjectsFolder(): Promise<void> {
    if (isBrowserProjectStorage()) {
        throw new Error('Project folders are available in the desktop app. Use project backup export/import on this device.');
    }

    await apiRequest<{ ok: boolean }>(`${PROJECTS_FOLDER_API}/open`, {
        method: 'POST',
    });
}

export async function getTetherStatus(options: { includeImages?: boolean; knownCaptureIds?: string[] } = {}): Promise<TetherStatus> {
    if (isBrowserProjectStorage()) {
        return {
            isWatching: false,
            folderPath: null,
            projectId: null,
            autoEdit: false,
            startedAt: null,
            message: 'Tethered Mode requires the Windows desktop app.',
            captures: [],
            supportedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff'],
            rawExtensions: ['cr2', 'cr3', 'nef', 'arw', 'raf', 'dng'],
        };
    }

    const params = new URLSearchParams();
    if (options.includeImages) params.set('includeImages', '1');
    if (options.knownCaptureIds?.length) params.set('known', options.knownCaptureIds.join(','));
    const query = params.toString();
    return await apiRequest<TetherStatus>(`${TETHER_API}/status${query ? `?${query}` : ''}`, undefined, 10000);
}

export async function selectTetherFolder(): Promise<string | null> {
    if (isBrowserProjectStorage()) {
        throw new Error('Tethered folder picking is available in the Windows desktop app.');
    }

    const result = await apiRequest<{ path: string | null }>(`${TETHER_API}/folder-picker`, {
        method: 'POST',
    }, 125000);
    return result.path;
}

export async function startTetherSession(input: {
    folderPath: string;
    projectId: string;
    autoEdit: boolean;
}): Promise<TetherStatus> {
    if (isBrowserProjectStorage()) {
        throw new Error('Tethered Mode requires the Windows desktop app.');
    }

    return await apiRequest<TetherStatus>(`${TETHER_API}/start`, {
        method: 'POST',
        body: JSON.stringify(input),
    }, 30000);
}

export async function stopTetherSession(): Promise<TetherStatus> {
    if (isBrowserProjectStorage()) {
        return await getTetherStatus();
    }

    return await apiRequest<TetherStatus>(`${TETHER_API}/stop`, {
        method: 'POST',
    }, 30000);
}

export async function saveVirtualSetRender(input: {
    projectId: string;
    scene: unknown;
    dataUrl: string;
    name: string;
    width: number;
    height: number;
    format: 'png' | 'jpeg' | 'webp';
}): Promise<{
    id: string;
    name: string;
    dataUrl: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    createdAt: number;
    assetPath: string;
    scenePath: string | null;
    image: ImageState;
}> {
    if (isBrowserProjectStorage()) {
        const image = await saveBrowserImageAsset(input.projectId, {
            fileName: `${input.name}.${input.format === 'jpeg' ? 'jpg' : input.format}`,
            base64: input.dataUrl.split(',')[1] || null,
            mimeType: input.dataUrl.match(/^data:([^;]+);/)?.[1] || `image/${input.format}`,
            width: input.width,
            height: input.height,
        }, 'outputs');
        return {
            id: `virtual-set-render-${Date.now()}`,
            name: input.name,
            dataUrl: image.assetUrl || input.dataUrl,
            mimeType: image.mimeType || `image/${input.format}`,
            width: input.width,
            height: input.height,
            createdAt: Date.now(),
            assetPath: image.assetPath || '',
            scenePath: null,
            image,
        };
    }

    return await apiRequest(`${VIRTUAL_SET_API}/render`, {
        method: 'POST',
        body: JSON.stringify(input),
    }, 120000);
}

export async function useVirtualSetRenderAsReference(projectId: string, image: ImageState): Promise<Project> {
    if (isBrowserProjectStorage()) {
        const project = await getProject(projectId);
        const updatedProject: Project = {
            ...project,
            lastModified: Date.now(),
            state: {
                ...(project.state || {}),
                referenceImage: image,
            },
        };
        await saveProject(updatedProject);
        return updatedProject;
    }

    return await apiRequest<Project>(`${VIRTUAL_SET_API}/use-as-reference`, {
        method: 'POST',
        body: JSON.stringify({ projectId, image }),
    }, 120000);
}

export async function exportProjectBackup(projectId: string): Promise<Blob> {
    if (!isBrowserProjectStorage()) {
        throw new Error('Project backup export is available on mobile.');
    }

    const db = await getDB();
    const tx = db.transaction(PROJECTS_STORE, 'readonly');
    const project = await promisifyRequest(tx.objectStore(PROJECTS_STORE).get(projectId)) as Project | undefined;
    if (!project) throw new Error('Project not found.');

    const assets = await getBrowserAssetsForProject(projectId);
    const zip = new JSZip();
    zip.file('istudio-project.json', JSON.stringify({
        format: 'istudio-mobile-project',
        version: 1,
        exportedAt: Date.now(),
        project,
        assets: assets.map(({ blob: _blob, ...asset }) => asset),
    }, null, 2));

    for (const asset of assets) {
        zip.file(`assets/${asset.id}`, asset.blob);
    }

    return await zip.generateAsync({ type: 'blob' });
}

function rewriteProjectIdAndAssetPaths(value: unknown, oldProjectId: string, newProjectId: string): unknown {
    if (!value) return value;
    if (typeof value === 'string') {
        return value.replaceAll(
            `${MOBILE_ASSET_SCHEME}${encodeURIComponent(oldProjectId)}/`,
            `${MOBILE_ASSET_SCHEME}${encodeURIComponent(newProjectId)}/`,
        );
    }
    if (Array.isArray(value)) return value.map((item) => rewriteProjectIdAndAssetPaths(item, oldProjectId, newProjectId));
    if (typeof value === 'object') {
        const record: Record<string, unknown> = {};
        for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
            record[key] = rewriteProjectIdAndAssetPaths(childValue, oldProjectId, newProjectId);
        }
        return record;
    }
    return value;
}

export async function importProjectBackup(file: File): Promise<Project> {
    if (!isBrowserProjectStorage()) {
        throw new Error('Project backup import is available on mobile.');
    }

    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file('istudio-project.json') || zip.file('project.json');
    if (!manifestFile) {
        throw new Error('This does not look like an ISTUDIO project backup.');
    }

    const manifest = JSON.parse(await manifestFile.async('string')) as {
        project?: Project;
        assets?: Omit<BrowserProjectAsset, 'blob'>[];
    };
    const sourceProject = manifest.project || (manifest as unknown as Project);
    if (!sourceProject?.id || !sourceProject.name) {
        throw new Error('The project backup is missing project metadata.');
    }

    const existingProject = await getIndexedDbProjects().then((projects) => projects.find((project) => project.id === sourceProject.id));
    const oldProjectId = sourceProject.id;
    const newProjectId = existingProject ? `${oldProjectId}-${Date.now()}` : oldProjectId;
    const project = rewriteProjectIdAndAssetPaths({
        ...sourceProject,
        id: newProjectId,
        name: existingProject ? `${sourceProject.name} Import` : sourceProject.name,
        lastModified: Date.now(),
    }, oldProjectId, newProjectId) as Project;

    const assets = manifest.assets || [];
    for (const asset of assets) {
        const assetFile = zip.file(`assets/${asset.id}`);
        if (!assetFile) continue;
        await putBrowserAsset({
            projectId: newProjectId,
            assetId: asset.id,
            bucket: asset.bucket,
            fileName: asset.fileName,
            mimeType: asset.mimeType,
            width: asset.width,
            height: asset.height,
            blob: await assetFile.async('blob'),
        });
    }

    await saveBrowserProject(project);
    return await hydrateBrowserProject(project);
}

async function getIndexedDbProjects(): Promise<Project[]> {
    const db = await getDB();
    const tx = db.transaction(PROJECTS_STORE, 'readonly');
    const items = await promisifyRequest(tx.objectStore(PROJECTS_STORE).getAll());
    return items.sort((a, b) => b.lastModified - a.lastModified);
}

async function deleteIndexedDbProjectOnly(id: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(PROJECTS_STORE, 'readwrite');
    tx.objectStore(PROJECTS_STORE).delete(id);
    await promisifyTransaction(tx);
}

async function migrateIndexedDbProjectsToFolder(serverProjects: Project[]): Promise<void> {
    const indexedProjects = await getIndexedDbProjects();
    if (indexedProjects.length === 0) return;

    const serverIds = new Set(serverProjects.map(project => project.id));
    const projectsToMigrate = indexedProjects.filter(project => !serverIds.has(project.id));

    for (const project of projectsToMigrate) {
        await apiRequest<{ ok: boolean }>(`${PROJECTS_API}/${encodeURIComponent(project.id)}`, {
            method: 'PUT',
            body: JSON.stringify(project),
        });
    }

    for (const project of indexedProjects) {
        await deleteIndexedDbProjectOnly(project.id);
    }
}
