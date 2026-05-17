const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_RELAY_HEADER = 'x-istudio-gemini-key';
const GEMINI_RELAY_MAX_BYTES = 24 * 1024 * 1024;
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/metadreamx\.github\.io$/,
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${GEMINI_RELAY_HEADER}`,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(body, status = 200, origin = '') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

function allowedOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin)) ? origin : '';
}

function normalizeGeminiRelayError(status, message) {
  const lower = String(message || '').toLowerCase();
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

function normalizeGeminiRelayPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Gemini request payload is required.');
  }
  if (!payload.model || typeof payload.model !== 'string') {
    throw new Error('Gemini model is required.');
  }
  if (!payload.contents || typeof payload.contents !== 'object') {
    throw new Error('Gemini contents are required.');
  }

  const body = {
    contents: [payload.contents],
  };
  if (payload.config && typeof payload.config === 'object') {
    body.generationConfig = payload.config;
  }
  return body;
}

async function handleGenerate(request, origin) {
  const apiKey = (request.headers.get(GEMINI_RELAY_HEADER) || '').trim();
  if (!apiKey) {
    return jsonResponse({
      ok: false,
      errorCode: 'GEMINI_KEY_MISSING',
      userMessage: 'Add your Google Gemini API key in ISTUDIO Settings before analyzing or generating.',
      rawStatus: 401,
    }, 401, origin);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > GEMINI_RELAY_MAX_BYTES) {
    return jsonResponse({
      ok: false,
      errorCode: 'GEMINI_PAYLOAD_TOO_LARGE',
      userMessage: 'This Gemini request is too large. Use fewer assets or smaller batch images, then try again.',
      rawStatus: 413,
    }, 413, origin);
  }

  const payload = JSON.parse(rawBody);
  const geminiBody = normalizeGeminiRelayPayload(payload);
  const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(payload.model)}:generateContent`;
  const geminiResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(geminiBody),
  });
  const geminiJson = await geminiResponse.json().catch(() => null);

  if (!geminiResponse.ok) {
    const rawMessage = geminiJson?.error?.message || geminiResponse.statusText || 'Gemini request failed.';
    const normalized = normalizeGeminiRelayError(geminiResponse.status, rawMessage);
    return jsonResponse({
      ok: false,
      ...normalized,
      rawStatus: geminiResponse.status,
      rawMessage,
    }, geminiResponse.status, origin);
  }

  return jsonResponse({
    ok: true,
    modelUsed: payload.model,
    response: geminiJson,
  }, 200, origin);
}

export default {
  async fetch(request) {
    const origin = allowedOrigin(request);
    if (!origin) {
      return jsonResponse({
        ok: false,
        errorCode: 'GEMINI_ORIGIN_BLOCKED',
        userMessage: 'This ISTUDIO Gemini relay only accepts requests from the official GitHub Pages app.',
        rawStatus: 403,
      }, 403);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/gemini/generate') {
      try {
        return await handleGenerate(request, origin);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : 'Gemini relay failed.';
        const normalized = normalizeGeminiRelayError(500, rawMessage);
        return jsonResponse({
          ok: false,
          ...normalized,
          rawStatus: 500,
          rawMessage,
        }, 500, origin);
      }
    }

    return jsonResponse({
      ok: false,
      errorCode: 'GEMINI_ROUTE_NOT_FOUND',
      userMessage: 'Gemini relay route not found.',
      rawStatus: 404,
    }, 404, origin);
  },
};
