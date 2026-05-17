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
const sw = read('public/sw.js');

assert(
  gemini.includes("savedKey || process.env.API_KEY || process.env.GEMINI_API_KEY"),
  'User-saved API key must take priority over bundled/build-time keys.',
);

assert(
  gemini.includes("GEMINI_ANALYSIS_MODELS") && gemini.includes("generateContentWithModelFallback"),
  'Reference/target analysis must use Gemini model fallback.',
);

assert(
  gemini.includes("GEMINI_IMAGE_EDIT_MODELS") && gemini.includes("gemini-2.5-flash-image") && gemini.includes("generateImageEditWithFallback"),
  'Image generation must use the supported Gemini image model plus fallback handling.',
);

assert(
  !gemini.includes("imageAnalysisModel") && !gemini.includes("imageEditModel"),
  'Single hardcoded Gemini model constants should not be used.',
);

assert(
  style.includes("detectTransferableElements(analysisImage.base64, analysisImage.mimeType)") &&
  style.includes("analyzeReferenceScene(analysisImage.base64, analysisImage.mimeType)") &&
  style.includes("analyzeTargetImageDetails(targetInput.base64, targetInput.mimeType)"),
  'Reference and target analysis must preserve image MIME types.',
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
