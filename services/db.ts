import type { HistoryItem, Project } from '../types';

const DB_NAME = 'StyleTransferDB';
const DB_VERSION = 3; // Incremented version to add twins store
const STORE_NAME = 'history';
const PROJECTS_STORE = 'projects';
const PROJECTS_API = '/api/projects';
const PROJECTS_FOLDER_API = '/api/projects-folder';

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
            throw new Error(`Request failed with status ${response.status}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('Project storage server is not running. Restart ISTUDIO with LAUNCH.bat.');
        }
        return await response.json() as T;
    } finally {
        window.clearTimeout(timeout);
    }
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
    await apiRequest<{ ok: boolean }>(`${PROJECTS_API}/${encodeURIComponent(project.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...project, summary: undefined }),
    }, 120000);
}

export async function getProjects(): Promise<Project[]> {
    const serverProjects = await apiRequest<Project[]>(`${PROJECTS_API}?summary=1`);
    await migrateIndexedDbProjectsToFolder(serverProjects);
    return await apiRequest<Project[]>(`${PROJECTS_API}?summary=1`);
}

export async function getProject(id: string): Promise<Project> {
    return await apiRequest<Project>(`${PROJECTS_API}/${encodeURIComponent(id)}`);
}

export async function deleteProject(id: string): Promise<void> {
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
    mode: 'folder';
}

export async function getProjectStorageInfo(): Promise<ProjectStorageInfo> {
    const info = await apiRequest<{ path: string; projectCount: number; mode: 'folder' }>(PROJECTS_FOLDER_API);
    return {
        ...info,
        mode: 'folder',
    };
}

export async function openProjectsFolder(): Promise<void> {
    await apiRequest<{ ok: boolean }>(`${PROJECTS_FOLDER_API}/open`, {
        method: 'POST',
    });
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
