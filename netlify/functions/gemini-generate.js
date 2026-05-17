const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_RELAY_HEADER = 'x-istudio-gemini-key';
const GEMINI_RELAY_MAX_BYTES = 24 * 1024 * 1024;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function normalizeGeminiRelayError(status, message) {
  const lower = String(message || '').toLowerCase();
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

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, {
      ok: false,
      errorCode: 'GEMINI_METHOD_NOT_ALLOWED',
      userMessage: 'Gemini relay only accepts POST requests.',
      rawStatus: 405,
    });
  }

  const apiKey = String(event.headers?.[GEMINI_RELAY_HEADER] || event.headers?.[GEMINI_RELAY_HEADER.toLowerCase()] || '').trim();
  if (!apiKey) {
    return jsonResponse(401, {
      ok: false,
      errorCode: 'GEMINI_KEY_MISSING',
      userMessage: 'Add your Google Gemini API key in ISTUDIO Settings before analyzing or generating.',
      rawStatus: 401,
    });
  }

  const rawBody = event.body || '';
  if (Buffer.byteLength(rawBody, 'utf8') > GEMINI_RELAY_MAX_BYTES) {
    return jsonResponse(413, {
      ok: false,
      errorCode: 'GEMINI_PAYLOAD_TOO_LARGE',
      userMessage: 'This Gemini request is too large. Use fewer assets or smaller batch images, then try again.',
      rawStatus: 413,
    });
  }

  try {
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
      return jsonResponse(geminiResponse.status, {
        ok: false,
        ...normalized,
        rawStatus: geminiResponse.status,
        rawMessage,
      });
    }

    return jsonResponse(200, {
      ok: true,
      modelUsed: payload.model,
      response: geminiJson,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Gemini relay failed.';
    const normalized = normalizeGeminiRelayError(500, rawMessage);
    return jsonResponse(500, {
      ok: false,
      ...normalized,
      rawStatus: 500,
      rawMessage,
    });
  }
};
