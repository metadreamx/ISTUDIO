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
  gemini.includes("GEMINI_ANALYSIS_MODELS") && gemini.includes("gemini-3.5-flash") && gemini.includes("generateContentWithModelFallback") && gemini.includes("generateContentTransport(buildParams(model))"),
  'Reference/target analysis must use Gemini model fallback through the shared transport.',
);

const analysisModelOrder = gemini.match(/GEMINI_ANALYSIS_MODELS\s*=\s*\[([^\]]+)\]/s)?.[1] || '';
assert(
  analysisModelOrder.indexOf("gemini-3.5-flash") > -1 &&
    analysisModelOrder.indexOf("gemini-3-flash-preview") > analysisModelOrder.indexOf("gemini-3.5-flash") &&
    analysisModelOrder.indexOf("gemini-2.5-flash") > analysisModelOrder.indexOf("gemini-3-flash-preview") &&
    analysisModelOrder.indexOf("gemini-2.0-flash") > analysisModelOrder.indexOf("gemini-2.5-flash"),
  'Analysis/diagnostic/evaluation model order must be Gemini 3.5 Flash first, with existing analysis fallbacks preserved.',
);

assert(
  gemini.includes("GEMINI_IMAGE_EDIT_MODELS") && gemini.includes("gemini-3-pro-image-preview") && gemini.includes("gemini-3.1-flash-image-preview") && gemini.includes("gemini-2.5-flash-image") && gemini.includes("generateImageEditWithFallback"),
  'Image generation must use the supported Gemini image models plus fallback handling.',
);

const imageModelOrder = gemini.match(/GEMINI_IMAGE_EDIT_MODELS\s*=\s*\[([^\]]+)\]/s)?.[1] || '';
assert(
  imageModelOrder.indexOf("gemini-3-pro-image-preview") > -1 &&
    imageModelOrder.indexOf("gemini-3.1-flash-image-preview") > imageModelOrder.indexOf("gemini-3-pro-image-preview") &&
    imageModelOrder.indexOf("gemini-2.5-flash-image") > imageModelOrder.indexOf("gemini-3.1-flash-image-preview"),
  'Image edit model order must be quality-first: Gemini 3 Pro Image, Gemini 3.1 Flash Image, then Gemini 2.5 Flash Image.',
);

assert(
  !imageModelOrder.includes("gemini-3.5-flash"),
  'Gemini 3.5 Flash must not be used for image generation because it is text-output only.',
);

assert(
  gemini.includes("const GEMINI_IMAGE_SIZES = ['4K', '2K', '1K']"),
  'Image edit output sizes must try 4K before lower-resolution fallbacks.',
);

assert(
  gemini.includes("closestGeminiAspectRatio") &&
  gemini.includes("'2:3'") &&
  gemini.includes("'3:2'") &&
  style.includes("const targetFrameRatio = closestGeminiAspectRatio") &&
  style.includes("editImage(imageParts, prompt, targetFrameRatio, seed)") &&
  style.includes("Same dimensions, crop, and subject placement as the target"),
  'Reference Edit must derive the output ratio from the target and keep the original frame locked.',
);

assert(
  server.includes("matchFrame") &&
  server.includes("resize(requestedFrameWidth, requestedFrameHeight") &&
  server.includes("fit: 'fill'"),
  'Saved Reference Edit outputs must be normalized to the exact target pixel dimensions.',
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
  style.includes("detectTransferableElements(analysisImage.base64, analysisImage.mimeType, supportingInputs, promptEdit.trim())") &&
  style.includes("analyzeReferenceScene(analysisImage.base64, analysisImage.mimeType, supportingInputs, promptEdit.trim())") &&
  style.includes("analyzeTargetImageDetails(targetInput.base64, targetInput.mimeType)"),
  'Multi-reference and target analysis must preserve image MIME types and prompt direction.',
);

assert(
  style.includes("const qualityMode = queuedOrBatchCount > 1 ? 'batch' : 'single'") &&
  !style.includes("queuedOrBatchCount > 1 || targetImages.length > 1 ? 'batch' : 'single'"),
  'Single active edits must keep high-fidelity single-image quality even when more targets are loaded.',
);

assert(
  style.includes("evaluateRealism(") &&
  style.includes("referenceInput.base64") &&
  style.includes("transferSummary") &&
  style.includes("AUTOMATIC REALISM REPAIR PASS") &&
  style.includes("NO WASHED-OUT COMPOSITE") &&
  gemini.includes("sticker-like edges") &&
  gemini.includes("washed-out tones"),
  'Generation must include the realism repair pass and anti-sticker/anti-washout guidance.',
);

assert(
  gemini.includes("REFERENCE DNA TRANSFER") &&
  gemini.includes("weak reference transfer") &&
  gemini.includes("subject drift"),
  'Realism evaluation must judge reference DNA transfer, subject consistency, and compositing realism.',
);

assert(
  style.includes("REFERENCE TRANSFER CONTRACT") &&
  style.includes("SLIDER INTENSITY CONTRACT") &&
  style.includes("ACTIVE INTENSITY MATRIX") &&
  style.includes("buildReferenceTransferMatrix") &&
  style.includes("getIntensityBand") &&
  style.includes("0 means do not transfer") &&
  style.includes("1-25 means subtle influence") &&
  style.includes("76-100 means dominant transfer"),
  'Generation prompt must include an explicit reference transfer contract and slider intensity matrix.',
);

[
  'color_palette',
  'lighting',
  'mood_atmosphere',
  'spatial_dna',
  'background_elements',
  'foreground_elements',
  'post_processing',
  'camera_lens_effects',
].forEach((categoryId) => {
  assert(
    style.includes(`${categoryId}:`),
    `Prompt intensity matrix must define transfer behavior for ${categoryId}.`,
  );
});

assert(
  style.includes("Requested reference transfer summary") &&
  style.includes("negative repair reference"),
  'Realism repair must keep the same reference DNA while treating the first attempt as a negative repair reference.',
);

const referenceInputIndex = style.indexOf("generationReferenceImages.map((image) => imageToGeminiInput(image, 'reference'))");
const referencePushIndex = style.indexOf("loadedReferenceInputs.forEach((referenceInput)");
const customInputIndex = style.indexOf("const activeItemInputs = await Promise.all");
assert(
  referenceInputIndex > -1 && referencePushIndex > referenceInputIndex && customInputIndex > referencePushIndex,
  'Generation must include all real reference images before custom assets in every viewport/runtime.',
);

assert(
  style.includes("const MAX_REFERENCE_IMAGES = 4") &&
  style.includes("referenceImages: [nextReferenceImage, ...nextSupportingReferenceImages].filter(hasImageSource)") &&
  style.includes("PRIMARY Reference DNA") &&
  style.includes("SUPPORTING Reference DNA") &&
  style.includes("Multi-reference synthesis") &&
  style.includes("Prompt authority"),
  'Reference Edit must persist and synthesize one primary plus supporting references with prompt-guided art direction.',
);

assert(
  gemini.includes("EditImageQualityMode = 'single' | 'batch' | 'reference'") &&
  gemini.includes("supportingImages: Array<{ base64: string; mimeType: string }> = []") &&
  gemini.includes("USER CREATIVE DIRECTION"),
  'Gemini analysis must use the reference optimization profile and prompt-guided multi-image synthesis.',
);

assert(
  uploader.match(/accept=\"image\/\*\"/g)?.length === 2 && mainPanel.includes('accept="image/*"'),
  'Reference and target uploaders must accept browser-decodable mobile formats such as iPhone HEIC.',
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
