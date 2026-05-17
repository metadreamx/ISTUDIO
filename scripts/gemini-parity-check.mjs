import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const gemini = read('services/geminiService.ts');
const style = read('components/StyleTransferView.tsx');
const uploader = read('components/ImageUploader.tsx');
const mainPanel = read('components/MainPanel.tsx');
const css = read('index.css');
const indexHtml = read('index.html');
const sw = read('public/sw.js');
const server = read('server.ts');
const worker = read('worker/gemini-relay.js');
const netlifyFunction = read('netlify/functions/gemini-generate.js');
const netlifyConfig = read('netlify.toml');
const pagesWorkflow = read('.github/workflows/pages.yml');
const apiKeyModal = read('components/ApiKeyModal.tsx');

assert(
  gemini.includes("getStoredGeminiApiKey") && gemini.includes("getBuildGeminiApiKey") && gemini.includes("overrideKey || getStoredGeminiApiKey() || getBuildGeminiApiKey()"),
  'User-saved API key must take priority over bundled/build-time keys.',
);

assert(
  gemini.includes("GEMINI_ANALYSIS_MODELS") && gemini.includes("generateContentWithModelFallback") && gemini.includes("generateContentTransport(buildParams(model))"),
  'Reference/target analysis must use Gemini model fallback through the shared transport.',
);

assert(
  gemini.includes("GEMINI_IMAGE_EDIT_MODELS") && gemini.includes("gemini-2.5-flash-image") && gemini.includes("generateImageEditWithFallback"),
  'Image generation must use the supported Gemini image model plus fallback handling.',
);

assert(
  gemini.includes("getGeminiTransportMode") &&
  gemini.includes("getGeminiRelayDiagnostic") &&
  gemini.includes("local-relay") &&
  gemini.includes("netlify-relay") &&
  gemini.includes("cloud-relay") &&
  gemini.includes("/.netlify/functions/gemini-generate") &&
  gemini.includes("VITE_GEMINI_RELAY_URL"),
  'Gemini must support local relay, Netlify relay, cloud relay, and configured PWA relay URL transport modes.',
);

assert(
  !gemini.includes("imageAnalysisModel") && !gemini.includes("imageEditModel"),
  'Single hardcoded Gemini model constants should not be used.',
);

assert(
  server.includes("app.post('/api/gemini/generate'") &&
  server.includes("x-istudio-gemini-key") &&
  server.includes("proxyGeminiGenerate") &&
  server.includes("generationConfig"),
  'Desktop app must expose a local Gemini relay that forwards canonical generateContent payloads.',
);

assert(
  (worker.includes("metadreamx.github.io") || worker.includes("metadreamx\\.github\\.io")) &&
  worker.includes("OPTIONS") &&
  worker.includes("Access-Control-Allow-Origin") &&
  worker.includes("x-istudio-gemini-key") &&
  worker.includes("GEMINI_ORIGIN_BLOCKED") &&
  worker.includes("GEMINI_API_DISABLED"),
  'Cloudflare Worker relay must handle GitHub Pages CORS, key headers, and blocked origins.',
);

assert(
  netlifyFunction.includes("x-istudio-gemini-key") &&
  netlifyFunction.includes("generativelanguage.googleapis.com") &&
  netlifyFunction.includes("generationConfig") &&
  netlifyFunction.includes("GEMINI_API_DISABLED") &&
  netlifyFunction.includes("GEMINI_PAYLOAD_TOO_LARGE"),
  'Netlify Function relay must forward canonical Gemini requests and normalize common Gemini failures.',
);

assert(
  netlifyConfig.includes('functions = "netlify/functions"') &&
  netlifyConfig.includes('publish = "dist"') &&
  netlifyConfig.includes('VITE_HOSTING_TARGET = "netlify"'),
  'Netlify config must publish dist, use netlify/functions, and build the app in Netlify relay mode.',
);

assert(
  pagesWorkflow.includes("VITE_GEMINI_RELAY_URL: ${{ vars.VITE_GEMINI_RELAY_URL }}"),
  'GitHub Pages workflow must pass the configured Gemini relay URL into the PWA build.',
);

assert(
  pagesWorkflow.includes("Require Gemini relay URL") &&
  pagesWorkflow.includes("exit 1") &&
  pagesWorkflow.includes("VITE_GEMINI_RELAY_URL is not set"),
  'GitHub Pages workflow must fail loudly when the mobile Gemini relay URL is missing.',
);

assert(
  apiKeyModal.includes("Test AI") &&
  apiKeyModal.includes("testGeminiConnection") &&
  apiKeyModal.includes("AI connection ready") &&
  apiKeyModal.includes("getGeminiRelayDiagnostic"),
  'API key modal must include a mobile-safe AI connection test and user-friendly connection status.',
);

assert(
  style.includes("detectTransferableElements(analysisImage.base64, analysisImage.mimeType)") &&
  style.includes("analyzeReferenceScene(analysisImage.base64, analysisImage.mimeType)") &&
  style.includes("analyzeTargetImageDetails(targetInput.base64, targetInput.mimeType)"),
  'Reference and target analysis must preserve image MIME types.',
);

assert(
  style.includes("const qualityMode = queuedOrBatchCount > 1 ? 'batch' : 'single'") &&
  !style.includes("queuedOrBatchCount > 1 || targetImages.length > 1 ? 'batch' : 'single'"),
  'Single active edits must keep high-fidelity single-image quality even when more targets are loaded.',
);

assert(
  style.includes("evaluateRealism(newImageBase64") &&
  style.includes("AUTOMATIC REALISM REPAIR PASS") &&
  style.includes("NO WASHED-OUT COMPOSITE") &&
  gemini.includes("sticker-like edges") &&
  gemini.includes("washed-out tones"),
  'Generation must include the realism repair pass and anti-sticker/anti-washout guidance.',
);

const referenceInputIndex = style.indexOf("const referenceInput = await imageToGeminiInput(referenceImage, qualityMode)");
const referencePushIndex = style.indexOf("inlineData: { data: referenceInput.base64, mimeType: referenceInput.mimeType }");
const customInputIndex = style.indexOf("const activeItemInputs = await Promise.all");
assert(
  referenceInputIndex > -1 && referencePushIndex > referenceInputIndex && customInputIndex > referencePushIndex,
  'Generation must include the real reference image before custom assets in every viewport/runtime.',
);

assert(
  uploader.match(/accept=\"image\/\*\"/g)?.length === 2 && mainPanel.includes('accept="image/*"'),
  'Reference and target uploaders must accept browser-decodable mobile formats such as iPhone HEIC.',
);

assert(
  indexHtml.includes("user-scalable=no") &&
  indexHtml.includes("maximum-scale=1") &&
  indexHtml.includes("viewport-fit=cover") &&
  css.includes("height: 100svh") &&
  css.includes("body {\n    position: fixed;") &&
  css.includes("overscroll-behavior: none"),
  'Mobile app shell must lock to the phone viewport without page zoom or page scrolling.',
);

assert(
  mainPanel.includes("mobile-generate-row") &&
  mainPanel.includes("Original") &&
  mainPanel.includes("Result") &&
  mainPanel.includes("lg:hidden") &&
  mainPanel.includes("lg:flex-row"),
  'Mobile bottom dock must keep Original/Result visible and place Generate/Refine in a lower mobile row.',
);

assert(
  sw.includes("istudio-pwa-shell-v4") && sw.includes("request.mode === 'navigate'") && sw.indexOf("fetch(request)") < sw.indexOf("caches.match('./')"),
  'PWA shell must refresh navigations from network before using cache.',
);

assert(
  !fs.existsSync(path.join(root, 'src', 'services', 'geminiService.ts')),
  'The unused legacy src/services/geminiService.ts must stay removed.',
);

if (failures.length) {
  console.error('Gemini parity check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Gemini parity check passed.');
