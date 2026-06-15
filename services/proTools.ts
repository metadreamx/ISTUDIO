import type { ImageState, ProCullResult, ProToolImageResult, ProToolStatus } from '../types';
import { isBrowserProjectStorage } from './db';

const PRO_TOOLS_API = '/api/pro-tools';

async function apiRequest<T>(url: string, init?: RequestInit, timeoutMs = 180000): Promise<T> {
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
      const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
      throw new Error(body?.error || body?.message || `Request failed with status ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function desktopOnlyStatus(): ProToolStatus {
  return {
    available: false,
    installed: false,
    runtimeReady: false,
    acceleration: 'unavailable',
    message: 'Local Pro AI tools are available in the Windows desktop app.',
    models: [],
  };
}

function assertDesktopProTools() {
  if (isBrowserProjectStorage()) {
    throw new Error('Local Pro AI tools are available in the Windows desktop app.');
  }
}

export async function getProToolStatus(): Promise<ProToolStatus> {
  if (isBrowserProjectStorage()) return desktopOnlyStatus();
  return await apiRequest<ProToolStatus>(`${PRO_TOOLS_API}/status`, undefined, 30000);
}

export async function installProAiPack(): Promise<ProToolStatus> {
  assertDesktopProTools();
  return await apiRequest<ProToolStatus>(`${PRO_TOOLS_API}/install`, { method: 'POST' }, 600000);
}

export async function cullProImage(projectId: string, image: ImageState): Promise<ProCullResult> {
  assertDesktopProTools();
  return await apiRequest<ProCullResult>(`${PRO_TOOLS_API}/cull`, {
    method: 'POST',
    body: JSON.stringify({ projectId, image }),
  });
}

export async function removeProBackground(projectId: string, image: ImageState): Promise<ProToolImageResult> {
  assertDesktopProTools();
  return await apiRequest<ProToolImageResult>(`${PRO_TOOLS_API}/background-cutout`, {
    method: 'POST',
    body: JSON.stringify({ projectId, image }),
  });
}

export async function finishProImage(projectId: string, image: ImageState, settings: object): Promise<ProToolImageResult> {
  assertDesktopProTools();
  return await apiRequest<ProToolImageResult>(`${PRO_TOOLS_API}/finish`, {
    method: 'POST',
    body: JSON.stringify({ projectId, image, settings }),
  });
}
