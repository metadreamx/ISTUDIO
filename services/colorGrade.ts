import type {
  ColorGradeDiagnostics,
  ColorGradeSettings,
  ColorMatchMethod,
  ImageState,
  ResolvedColorMatchMethod,
} from '../types';
import { getImageSrc } from './imageAssets';

export const COLOR_GRADE_ENGINE_VERSION = '2.0.0';

export const DEFAULT_COLOR_GRADE_SETTINGS: ColorGradeSettings = {
  matchMethod: 'auto',
  autoMethod: 'lab',
  matchStrength: 94,
  luminanceMatch: 92,
  colorMatch: 90,
  contrastMatch: 86,
  detailProtection: 84,
  exposure: 0,
  brightness: 0,
  contrast: 0,
  gamma: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  clarity: 0,
  sharpness: 0,
  shadowColor: '#4a5d88',
  shadowColorStrength: 0,
  midtoneColor: '#808080',
  midtoneColorStrength: 0,
  highlightColor: '#d6a36d',
  highlightColorStrength: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
};

export interface ColorProfile {
  histogram: number[];
  cdf: number[];
  percentiles: number[];
  meanY: number;
  stdY: number;
  meanCb: number;
  stdCb: number;
  meanCr: number;
  stdCr: number;
  meanA: number;
  stdA: number;
  meanB: number;
  stdB: number;
  covariance: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  clusters: ColorCluster[];
  gradientEnergy: number;
  localContrast: number;
  clippedShadows: number;
  clippedHighlights: number;
  samples: Array<[number, number, number]>;
  averageColor: string;
}

export interface ColorCluster {
  center: [number, number, number];
  spread: [number, number, number];
  weight: number;
}

export interface ColorGradeRenderResult {
  canvas: HTMLCanvasElement;
  profile: ColorProfile;
}

export interface AutomaticColorMatchRecipe {
  settings: ColorGradeSettings;
  summary: string;
  diagnostics: ColorGradeDiagnostics;
}

export interface ColorGradeLutRecipe {
  version: string;
  size: number;
  data: number[];
  settings: ColorGradeSettings;
  diagnostics?: ColorGradeDiagnostics | null;
}

const PROFILE_QUANTILES = [0, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 1];
const TILE_SIZE = 768;

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const normalized = clamp((value - edge0) / Math.max(0.00001, edge1 - edge0));
  return normalized * normalized * (3 - 2 * normalized);
};

const srgbToLinear = (value: number) => {
  const normalized = clamp(value / 255);
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
};

const linearToSrgb = (value: number) => {
  const bounded = clamp(value);
  const encoded = bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * Math.pow(bounded, 1 / 2.4) - 0.055;
  return Math.round(clamp(encoded) * 255);
};

const linearLuminance = (red: number, green: number, blue: number) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

function linearRgbToOklab(red: number, green: number, blue: number) {
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(Math.max(0, l));
  const mRoot = Math.cbrt(Math.max(0, m));
  const sRoot = Math.cbrt(Math.max(0, s));
  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function oklabToLinearRgb(l: number, a: number, b: number) {
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * b;
  const lLinear = lRoot * lRoot * lRoot;
  const mLinear = mRoot * mRoot * mRoot;
  const sLinear = sRoot * sRoot * sRoot;
  return {
    red: 4.0767416621 * lLinear - 3.3077115913 * mLinear + 0.2309699292 * sLinear,
    green: -1.2684380046 * lLinear + 2.6097574011 * mLinear - 0.3413193965 * sLinear,
    blue: -0.0041960863 * lLinear - 0.7034186147 * mLinear + 1.707614701 * sLinear,
  };
}

function rgbToYCbCr(red: number, green: number, blue: number) {
  return {
    y: 0.299 * red + 0.587 * green + 0.114 * blue,
    cb: 128 - 0.168736 * red - 0.331264 * green + 0.5 * blue,
    cr: 128 + 0.5 * red - 0.418688 * green - 0.081312 * blue,
  };
}

function parseHexColor(value: string) {
  const normalized = value.replace('#', '').padEnd(6, '0').slice(0, 6);
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function colorDirection(value: string) {
  const rgb = parseHexColor(value);
  const lab = linearRgbToOklab(srgbToLinear(rgb.red), srgbToLinear(rgb.green), srgbToLinear(rgb.blue));
  const magnitude = Math.max(0.0001, Math.sqrt(lab.a * lab.a + lab.b * lab.b));
  return { a: lab.a / magnitude, b: lab.b / magnitude };
}

function percentileFromHistogram(histogram: number[], count: number, quantile: number) {
  const target = Math.max(0, Math.min(count - 1, quantile * Math.max(0, count - 1)));
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative > target) return index / 255;
  }
  return 1;
}

function colorDistance(left: [number, number, number], right: [number, number, number]) {
  const dl = (left[0] - right[0]) * 0.72;
  const da = left[1] - right[1];
  const db = left[2] - right[2];
  return dl * dl + da * da + db * db;
}

function buildColorClusters(samples: Array<[number, number, number]>, clusterCount = 5): ColorCluster[] {
  if (!samples.length) return [];
  const centers: Array<[number, number, number]> = [[...samples[Math.floor(samples.length / 2)]]];
  while (centers.length < Math.min(clusterCount, samples.length)) {
    let bestSample = samples[0];
    let bestDistance = -1;
    for (let index = 0; index < samples.length; index += Math.max(1, Math.floor(samples.length / 2500))) {
      const sample = samples[index];
      const distance = Math.min(...centers.map((center) => colorDistance(sample, center)));
      if (distance > bestDistance) {
        bestDistance = distance;
        bestSample = sample;
      }
    }
    centers.push([...bestSample]);
  }

  const assignments = new Uint8Array(samples.length);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const sample = samples[sampleIndex];
      let selected = 0;
      let selectedDistance = Number.POSITIVE_INFINITY;
      for (let clusterIndex = 0; clusterIndex < centers.length; clusterIndex += 1) {
        const distance = colorDistance(sample, centers[clusterIndex]);
        if (distance < selectedDistance) {
          selectedDistance = distance;
          selected = clusterIndex;
        }
      }
      assignments[sampleIndex] = selected;
      sums[selected][0] += sample[0];
      sums[selected][1] += sample[1];
      sums[selected][2] += sample[2];
      sums[selected][3] += 1;
    }
    for (let clusterIndex = 0; clusterIndex < centers.length; clusterIndex += 1) {
      const count = sums[clusterIndex][3];
      if (count > 0) {
        centers[clusterIndex] = [
          sums[clusterIndex][0] / count,
          sums[clusterIndex][1] / count,
          sums[clusterIndex][2] / count,
        ];
      }
    }
  }

  const spreadSums = centers.map(() => [0, 0, 0, 0]);
  for (let index = 0; index < samples.length; index += 1) {
    const cluster = assignments[index];
    const sample = samples[index];
    const center = centers[cluster];
    spreadSums[cluster][0] += (sample[0] - center[0]) ** 2;
    spreadSums[cluster][1] += (sample[1] - center[1]) ** 2;
    spreadSums[cluster][2] += (sample[2] - center[2]) ** 2;
    spreadSums[cluster][3] += 1;
  }

  return centers.map((center, index) => {
    const count = Math.max(1, spreadSums[index][3]);
    return {
      center,
      spread: [
        Math.sqrt(spreadSums[index][0] / count + 0.000001),
        Math.sqrt(spreadSums[index][1] / count + 0.000001),
        Math.sqrt(spreadSums[index][2] / count + 0.000001),
      ] as [number, number, number],
      weight: spreadSums[index][3] / samples.length,
    };
  }).sort((left, right) => right.weight - left.weight);
}

function imageDataProfile(imageData: ImageData): ColorProfile {
  const histogram = Array.from({ length: 256 }, () => 0);
  let sumY = 0;
  let sumY2 = 0;
  let sumCb = 0;
  let sumCb2 = 0;
  let sumCr = 0;
  let sumCr2 = 0;
  let sumA = 0;
  let sumA2 = 0;
  let sumB = 0;
  let sumB2 = 0;
  let sumYA = 0;
  let sumYB = 0;
  let sumAB = 0;
  let sumRed = 0;
  let sumGreen = 0;
  let sumBlue = 0;
  let count = 0;
  let clippedShadows = 0;
  let clippedHighlights = 0;
  let gradientEnergy = 0;
  let gradientSamples = 0;
  let localContrast = 0;
  const samples: Array<[number, number, number]> = [];

  const pixelCount = imageData.width * imageData.height;
  const stride = Math.max(1, Math.floor(pixelCount / 240000));
  const sampleStride = Math.max(stride, Math.floor(pixelCount / 12000));
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const index = pixel * 4;
    if (imageData.data[index + 3] < 8) continue;
    const redByte = imageData.data[index];
    const greenByte = imageData.data[index + 1];
    const blueByte = imageData.data[index + 2];
    const linearRed = srgbToLinear(redByte);
    const linearGreen = srgbToLinear(greenByte);
    const linearBlue = srgbToLinear(blueByte);
    const lab = linearRgbToOklab(linearRed, linearGreen, linearBlue);
    const yCbCr = rgbToYCbCr(redByte, greenByte, blueByte);
    const bucket = Math.round(clamp(lab.l) * 255);
    histogram[bucket] += 1;
    if (lab.l <= 0.012) clippedShadows += 1;
    if (lab.l >= 0.985) clippedHighlights += 1;
    sumY += lab.l;
    sumY2 += lab.l * lab.l;
    sumCb += yCbCr.cb;
    sumCb2 += yCbCr.cb * yCbCr.cb;
    sumCr += yCbCr.cr;
    sumCr2 += yCbCr.cr * yCbCr.cr;
    sumA += lab.a;
    sumA2 += lab.a * lab.a;
    sumB += lab.b;
    sumB2 += lab.b * lab.b;
    sumYA += lab.l * lab.a;
    sumYB += lab.l * lab.b;
    sumAB += lab.a * lab.b;
    sumRed += redByte;
    sumGreen += greenByte;
    sumBlue += blueByte;
    if (pixel % sampleStride < stride && samples.length < 12000) {
      samples.push([lab.l, lab.a, lab.b]);
    }
    count += 1;
  }

  const gradientStride = Math.max(1, Math.floor(Math.max(imageData.width, imageData.height) / 320));
  for (let y = gradientStride; y < imageData.height; y += gradientStride) {
    for (let x = gradientStride; x < imageData.width; x += gradientStride) {
      const index = (y * imageData.width + x) * 4;
      const leftIndex = (y * imageData.width + x - gradientStride) * 4;
      const upIndex = ((y - gradientStride) * imageData.width + x) * 4;
      const luminance = linearLuminance(
        srgbToLinear(imageData.data[index]),
        srgbToLinear(imageData.data[index + 1]),
        srgbToLinear(imageData.data[index + 2]),
      );
      const left = linearLuminance(
        srgbToLinear(imageData.data[leftIndex]),
        srgbToLinear(imageData.data[leftIndex + 1]),
        srgbToLinear(imageData.data[leftIndex + 2]),
      );
      const up = linearLuminance(
        srgbToLinear(imageData.data[upIndex]),
        srgbToLinear(imageData.data[upIndex + 1]),
        srgbToLinear(imageData.data[upIndex + 2]),
      );
      const gradient = Math.hypot(luminance - left, luminance - up);
      gradientEnergy += gradient;
      localContrast += Math.abs(luminance - (left + up) * 0.5);
      gradientSamples += 1;
    }
  }

  const safeCount = Math.max(1, count);
  const meanY = sumY / safeCount;
  const meanCb = sumCb / safeCount;
  const meanCr = sumCr / safeCount;
  const meanA = sumA / safeCount;
  const meanB = sumB / safeCount;
  const stdY = Math.sqrt(Math.max(0.000001, sumY2 / safeCount - meanY * meanY));
  const stdCb = Math.sqrt(Math.max(1, sumCb2 / safeCount - meanCb * meanCb));
  const stdCr = Math.sqrt(Math.max(1, sumCr2 / safeCount - meanCr * meanCr));
  const stdA = Math.sqrt(Math.max(0.000001, sumA2 / safeCount - meanA * meanA));
  const stdB = Math.sqrt(Math.max(0.000001, sumB2 / safeCount - meanB * meanB));
  const covarianceYA = sumYA / safeCount - meanY * meanA;
  const covarianceYB = sumYB / safeCount - meanY * meanB;
  const covarianceAB = sumAB / safeCount - meanA * meanB;
  let cumulative = 0;
  const cdf = histogram.map((value) => {
    cumulative += value;
    return cumulative / safeCount;
  });
  return {
    histogram,
    cdf,
    percentiles: PROFILE_QUANTILES.map((quantile) => percentileFromHistogram(histogram, safeCount, quantile)),
    meanY,
    stdY,
    meanCb,
    stdCb,
    meanCr,
    stdCr,
    meanA,
    stdA,
    meanB,
    stdB,
    covariance: [
      [stdY * stdY, covarianceYA, covarianceYB],
      [covarianceYA, stdA * stdA, covarianceAB],
      [covarianceYB, covarianceAB, stdB * stdB],
    ],
    clusters: buildColorClusters(samples),
    gradientEnergy: gradientEnergy / Math.max(1, gradientSamples),
    localContrast: localContrast / Math.max(1, gradientSamples),
    clippedShadows: clippedShadows / safeCount,
    clippedHighlights: clippedHighlights / safeCount,
    samples,
    averageColor: `rgb(${Math.round(sumRed / safeCount)}, ${Math.round(sumGreen / safeCount)}, ${Math.round(sumBlue / safeCount)})`,
  };
}

async function loadImage(image: ImageState): Promise<HTMLImageElement> {
  const source = getImageSrc(image);
  if (!source) throw new Error('The selected image could not be loaded.');
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('The selected image could not be decoded.'));
    element.src = source;
  });
}

function imageToCanvas(image: HTMLImageElement, maxEdge?: number) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = maxEdge && Math.max(sourceWidth, sourceHeight) > maxEdge
    ? maxEdge / Math.max(sourceWidth, sourceHeight)
    : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Color processing is unavailable on this computer.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function profileCanvas(canvas: HTMLCanvasElement) {
  const maxEdge = 640;
  const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
  const sample = document.createElement('canvas');
  sample.width = Math.max(1, Math.round(canvas.width * scale));
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  const context = sample.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  return imageDataProfile(context.getImageData(0, 0, sample.width, sample.height));
}

export async function analyzeColorProfile(image: ImageState): Promise<ColorProfile> {
  const loaded = await loadImage(image);
  return profileCanvas(imageToCanvas(loaded, 640));
}

function covarianceDistance(source: ColorProfile, reference: ColorProfile) {
  let distance = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const scale = Math.max(0.00001, Math.abs(source.covariance[row][column]), Math.abs(reference.covariance[row][column]));
      distance += Math.abs(reference.covariance[row][column] - source.covariance[row][column]) / scale;
    }
  }
  return distance / 9;
}

function percentileDistance(source: ColorProfile, reference: ColorProfile) {
  const meaningful = source.percentiles.slice(1, -1);
  return meaningful.reduce((total, value, index) => (
    total + Math.abs(reference.percentiles[index + 1] - value)
  ), 0) / Math.max(1, meaningful.length);
}

function chooseMatchMethod(
  toneDistance: number,
  chromaDistance: number,
  correlationDistance: number,
): ResolvedColorMatchMethod {
  if (toneDistance < 0.025 && chromaDistance < 0.012 && correlationDistance < 0.35) return 'natural';
  if (correlationDistance > 1.65 || (toneDistance > 0.075 && chromaDistance > 0.065)) return 'pdf';
  if (toneDistance > 0.085 && chromaDistance < 0.025) return 'histogram';
  if (chromaDistance > 0.055 && correlationDistance < 0.72) return 'reinhard';
  if (correlationDistance > 1.1 && toneDistance < 0.075) return 'distribution';
  return 'lab';
}

export async function buildAutomaticColorMatchRecipe(
  target: ImageState,
  reference: ImageState,
): Promise<AutomaticColorMatchRecipe> {
  const [source, destination] = await Promise.all([
    analyzeColorProfile(target),
    analyzeColorProfile(reference),
  ]);
  const toneDistance = percentileDistance(source, destination);
  const chromaDistance = Math.hypot(destination.meanA - source.meanA, destination.meanB - source.meanB);
  const correlationDistance = covarianceDistance(source, destination);
  const contrastRatio = clamp(destination.stdY / Math.max(0.0001, source.stdY), 0.65, 1.55);
  const sourceChromaSpread = Math.hypot(source.stdA, source.stdB);
  const destinationChromaSpread = Math.hypot(destination.stdA, destination.stdB);
  const chromaSpreadRatio = destinationChromaSpread / Math.max(0.0001, sourceChromaSpread);
  const suggestedMethod = chooseMatchMethod(toneDistance, chromaDistance, correlationDistance);
  const baseSettings: ColorGradeSettings = {
    ...DEFAULT_COLOR_GRADE_SETTINGS,
    matchMethod: 'auto',
    autoMethod: suggestedMethod,
    matchStrength: Math.round(clamp(88 + toneDistance * 90 + chromaDistance * 120, 88, 100)),
    luminanceMatch: Math.round(clamp(84 + toneDistance * 150, 84, 100)),
    colorMatch: Math.round(clamp(82 + chromaDistance * 240 + correlationDistance * 5, 82, 100)),
    contrastMatch: Math.round(clamp(76 + Math.abs(Math.log2(contrastRatio)) * 34, 76, 98)),
    detailProtection: Math.round(clamp(88 - toneDistance * 38, 78, 90)),
    brightness: Math.round(clamp((destination.meanY - source.meanY) * 34, -16, 16)),
    contrast: Math.round(clamp((contrastRatio - 1) * 32, -18, 18)),
    highlights: Math.round(clamp((destination.percentiles[6] - source.percentiles[6]) * 105, -24, 24)),
    shadows: Math.round(clamp((destination.percentiles[2] - source.percentiles[2]) * 105, -24, 24)),
    whites: Math.round(clamp((destination.percentiles[7] - source.percentiles[7]) * 72, -16, 16)),
    blacks: Math.round(clamp((destination.percentiles[1] - source.percentiles[1]) * 72, -16, 16)),
    temperature: Math.round(clamp((destination.meanB - source.meanB) * 350, -28, 28)),
    tint: Math.round(clamp((destination.meanA - source.meanA) * 320, -22, 22)),
    vibrance: Math.round(clamp((chromaSpreadRatio - 1) * 25, -16, 20)),
    saturation: Math.round(clamp((chromaSpreadRatio - 1) * 15, -12, 14)),
    clarity: Math.round(clamp((destination.localContrast / Math.max(0.0001, source.localContrast) - 1) * 18, -10, 10)),
    sharpness: 2,
  };

  const candidateMethods = ([
    suggestedMethod,
    'pdf',
    'lab',
    'hybrid',
    'distribution',
    'reinhard',
  ] as ResolvedColorMatchMethod[]).filter((method, index, methods) => methods.indexOf(method) === index);

  const candidates = [];
  for (const method of candidateMethods) {
    const candidateSettings: ColorGradeSettings = {
      ...baseSettings,
      matchMethod: method,
      autoMethod: method,
    };
    const rendered = await renderColorGrade(target, reference, candidateSettings, 640);
    const output = rendered.profile;
    const toneError = percentileDistance(output, destination);
    const colorError = Math.hypot(output.meanA - destination.meanA, output.meanB - destination.meanB);
    const covarianceError = covarianceDistance(output, destination);
    const contrastError = Math.abs(Math.log2(output.stdY / Math.max(0.0001, destination.stdY)));
    const detailError = Math.abs(Math.log2(output.gradientEnergy / Math.max(0.00001, source.gradientEnergy)));
    const clipping = output.clippedShadows + output.clippedHighlights;
    const toneScore = clamp(1 - toneError / 0.18);
    const colorScore = clamp(1 - colorError / 0.12 - covarianceError / 7);
    const contrastScore = clamp(1 - contrastError / 1.2);
    const detailScore = clamp(1 - detailError / 2.6);
    const clippingScore = clamp(1 - clipping / 0.012);
    const overallScore = (
      toneScore * 0.29
      + colorScore * 0.29
      + contrastScore * 0.18
      + detailScore * 0.17
      + clippingScore * 0.07
    );
    candidates.push({
      method,
      settings: candidateSettings,
      output,
      toneScore,
      colorScore,
      contrastScore,
      detailScore,
      clippingScore,
      overallScore,
    });
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  }
  candidates.sort((left, right) => right.overallScore - left.overallScore);
  const best = candidates[0];
  const runnerUp = candidates[1];
  const settings: ColorGradeSettings = {
    ...best.settings,
    matchMethod: 'auto',
    autoMethod: best.method,
  };

  const diagnostics: ColorGradeDiagnostics = {
    engineVersion: COLOR_GRADE_ENGINE_VERSION,
    selectedStrategy: best.method,
    confidence: Math.round(clamp(0.62 + (best.overallScore - (runnerUp?.overallScore || 0)) * 1.8, 0.58, 0.99) * 100),
    overallScore: Math.round(best.overallScore * 100),
    toneScore: Math.round(best.toneScore * 100),
    colorScore: Math.round(best.colorScore * 100),
    contrastScore: Math.round(best.contrastScore * 100),
    detailScore: Math.round(best.detailScore * 100),
    clippingScore: Math.round(best.clippingScore * 100),
    clippedShadows: best.output.clippedShadows,
    clippedHighlights: best.output.clippedHighlights,
    analyzedAt: Date.now(),
  };

  const methodCopy: Record<ResolvedColorMatchMethod, string> = {
    natural: 'Protected perceptual',
    histogram: 'Tone-distribution',
    reinhard: 'Reinhard palette',
    distribution: 'Multivariate color',
    hybrid: 'Compound histogram and multivariate',
    lab: 'Optimal transport with gradient-safe',
    pdf: 'Iterative probability-distribution',
  };
  const temperatureCopy = settings.temperature > 3
    ? 'warmer color balance'
    : settings.temperature < -3
      ? 'cooler color balance'
      : 'neutral color balance';
  const contrastCopy = contrastRatio > 1.08
    ? 'stronger contrast'
    : contrastRatio < 0.92
      ? 'softer contrast'
      : 'matched contrast';

  return {
    settings,
    diagnostics,
    summary: `Master Match selected ${methodCopy[best.method]} at ${diagnostics.overallScore}% similarity for ${temperatureCopy}, ${contrastCopy}, and protected source detail.`,
  };
}

function smoothToneMap(value: number, source: number[], reference: number[]) {
  const bounded = clamp(value);
  let segment = 0;
  while (segment < source.length - 2 && bounded > source[segment + 1]) segment += 1;
  const sourceLow = source[segment];
  const sourceHigh = Math.max(sourceLow + 0.0001, source[segment + 1]);
  const referenceLow = reference[segment];
  const referenceHigh = reference[segment + 1];
  const position = smoothstep(0, 1, (bounded - sourceLow) / (sourceHigh - sourceLow));
  return clamp(referenceLow + (referenceHigh - referenceLow) * position);
}

function protectedReferencePercentiles(source: number[], reference: number[], strength = 1) {
  const protectedValues = reference.map((value, index) => {
    if (index === 0) return 0;
    if (index === reference.length - 1) return 1;
    const maximumShift = (index <= 2 || index >= reference.length - 3 ? 0.24 : 0.34) * clamp(strength, 0.35, 1);
    return clamp(source[index] + clamp(value - source[index], -maximumShift, maximumShift));
  });
  for (let index = 1; index < protectedValues.length; index += 1) {
    protectedValues[index] = Math.max(protectedValues[index], protectedValues[index - 1] + 0.002);
  }
  protectedValues[protectedValues.length - 1] = 1;
  return protectedValues;
}

function softBound(value: number) {
  if (value < 0) return 0;
  if (value <= 0.92) return value;
  return 0.92 + 0.08 * (1 - Math.exp(-(value - 0.92) / 0.08));
}

function gamutMapOklab(lightness: number, a: number, b: number) {
  const boundedLightness = softBound(lightness);
  const initial = oklabToLinearRgb(boundedLightness, a, b);
  if (
    initial.red >= 0 && initial.red <= 1
    && initial.green >= 0 && initial.green <= 1
    && initial.blue >= 0 && initial.blue <= 1
  ) {
    return initial;
  }

  let low = 0;
  let high = 1;
  let best = oklabToLinearRgb(boundedLightness, 0, 0);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const scale = (low + high) / 2;
    const candidate = oklabToLinearRgb(boundedLightness, a * scale, b * scale);
    const inGamut = candidate.red >= 0 && candidate.red <= 1
      && candidate.green >= 0 && candidate.green <= 1
      && candidate.blue >= 0 && candidate.blue <= 1;
    if (inGamut) {
      low = scale;
      best = candidate;
    } else {
      high = scale;
    }
  }
  return best;
}

type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

interface ProjectedDistributionMap {
  sourceMin: number;
  sourceMax: number;
  referenceMin: number;
  referenceMax: number;
  lookup: Float32Array;
}

interface PdfTransferStage {
  rotation: Matrix3;
  inverse: Matrix3;
  maps: [ProjectedDistributionMap, ProjectedDistributionMap, ProjectedDistributionMap];
}

interface ColorLut3D {
  size: number;
  minimum: [number, number, number];
  maximum: [number, number, number];
  values: Float32Array;
}

interface ColorTransferTransforms {
  multivariate: Matrix3;
  optimal: Matrix3;
  pdf: ColorLut3D | null;
  clusters: ClusterTransfer[];
}

interface ClusterTransfer {
  source: ColorCluster;
  reference: ColorCluster;
}

function cholesky3(matrix: Matrix3): Matrix3 {
  const result: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const epsilon = 0.000001;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = matrix[row][column];
      for (let index = 0; index < column; index += 1) {
        sum -= result[row][index] * result[column][index];
      }
      if (row === column) {
        result[row][column] = Math.sqrt(Math.max(epsilon, sum));
      } else {
        result[row][column] = sum / Math.max(epsilon, result[column][column]);
      }
    }
  }
  return result;
}

function invertLower3(matrix: Matrix3): Matrix3 {
  const inverse: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let row = 0; row < 3; row += 1) {
    inverse[row][row] = 1 / Math.max(0.000001, matrix[row][row]);
    for (let column = 0; column < row; column += 1) {
      let sum = 0;
      for (let index = column; index < row; index += 1) {
        sum += matrix[row][index] * inverse[index][column];
      }
      inverse[row][column] = -sum / Math.max(0.000001, matrix[row][row]);
    }
  }
  return inverse;
}

function multiplyMatrix3(left: Matrix3, right: Matrix3): Matrix3 {
  const result: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      result[row][column] =
        left[row][0] * right[0][column]
        + left[row][1] * right[1][column]
        + left[row][2] * right[2][column];
    }
  }
  return result;
}

function multiplyVector3(matrix: Matrix3, vector: [number, number, number]): [number, number, number] {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function transposeMatrix3(matrix: Matrix3): Matrix3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function symmetricMatrixPower(matrix: Matrix3, exponent: number): Matrix3 {
  const diagonalized: Matrix3 = [
    [matrix[0][0] + 0.000001, matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1] + 0.000001, matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2] + 0.000001],
  ];
  const eigenvectors: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (let iteration = 0; iteration < 18; iteration += 1) {
    let row = 0;
    let column = 1;
    let largest = Math.abs(diagonalized[0][1]);
    for (const [candidateRow, candidateColumn] of [[0, 2], [1, 2]] as const) {
      const magnitude = Math.abs(diagonalized[candidateRow][candidateColumn]);
      if (magnitude > largest) {
        largest = magnitude;
        row = candidateRow;
        column = candidateColumn;
      }
    }
    if (largest < 0.00000001) break;

    const angle = 0.5 * Math.atan2(
      2 * diagonalized[row][column],
      diagonalized[column][column] - diagonalized[row][row],
    );
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    for (let index = 0; index < 3; index += 1) {
      const rowValue = diagonalized[row][index];
      const columnValue = diagonalized[column][index];
      diagonalized[row][index] = cosine * rowValue - sine * columnValue;
      diagonalized[column][index] = sine * rowValue + cosine * columnValue;
    }
    for (let index = 0; index < 3; index += 1) {
      const rowValue = diagonalized[index][row];
      const columnValue = diagonalized[index][column];
      diagonalized[index][row] = cosine * rowValue - sine * columnValue;
      diagonalized[index][column] = sine * rowValue + cosine * columnValue;
    }
    diagonalized[row][column] = 0;
    diagonalized[column][row] = 0;

    for (let index = 0; index < 3; index += 1) {
      const rowValue = eigenvectors[index][row];
      const columnValue = eigenvectors[index][column];
      eigenvectors[index][row] = cosine * rowValue - sine * columnValue;
      eigenvectors[index][column] = sine * rowValue + cosine * columnValue;
    }
  }

  const powered: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let index = 0; index < 3; index += 1) {
    powered[index][index] = Math.pow(Math.max(0.000001, diagonalized[index][index]), exponent);
  }
  return multiplyMatrix3(multiplyMatrix3(eigenvectors, powered), transposeMatrix3(eigenvectors));
}

function distributionTransform(source: ColorProfile, reference: ColorProfile): Matrix3 {
  const sourceRoot = cholesky3(source.covariance);
  const referenceRoot = cholesky3(reference.covariance);
  return multiplyMatrix3(referenceRoot, invertLower3(sourceRoot));
}

function mongeKantorovichTransform(source: ColorProfile, reference: ColorProfile): Matrix3 {
  const sourceRoot = symmetricMatrixPower(source.covariance, 0.5);
  const sourceInverseRoot = symmetricMatrixPower(source.covariance, -0.5);
  const middle = multiplyMatrix3(multiplyMatrix3(sourceRoot, reference.covariance), sourceRoot);
  const middleRoot = symmetricMatrixPower(middle, 0.5);
  return multiplyMatrix3(multiplyMatrix3(sourceInverseRoot, middleRoot), sourceInverseRoot);
}

function buildClusterTransfers(source: ColorProfile, reference: ColorProfile): ClusterTransfer[] {
  const sourceClusters = source.clusters.slice(0, 5);
  const referenceClusters = reference.clusters.slice(0, 5);
  if (!sourceClusters.length || !referenceClusters.length) return [];
  const used = new Set<number>();
  return sourceClusters.map((sourceCluster) => {
    let selected = 0;
    let selectedCost = Number.POSITIVE_INFINITY;
    for (let index = 0; index < referenceClusters.length; index += 1) {
      if (used.has(index) && used.size < referenceClusters.length) continue;
      const referenceCluster = referenceClusters[index];
      const lightnessCost = Math.abs(sourceCluster.center[0] - referenceCluster.center[0]) * 0.72;
      const chromaCost = Math.hypot(
        sourceCluster.center[1] - referenceCluster.center[1],
        sourceCluster.center[2] - referenceCluster.center[2],
      );
      const weightCost = Math.abs(sourceCluster.weight - referenceCluster.weight) * 0.22;
      const cost = lightnessCost + chromaCost + weightCost;
      if (cost < selectedCost) {
        selectedCost = cost;
        selected = index;
      }
    }
    used.add(selected);
    return { source: sourceCluster, reference: referenceClusters[selected] };
  });
}

function applyClusterTransfer(
  color: [number, number, number],
  transfers: ClusterTransfer[],
): [number, number, number] {
  if (!transfers.length) return color;
  let totalWeight = 0;
  let outputL = 0;
  let outputA = 0;
  let outputB = 0;
  for (const transfer of transfers) {
    const source = transfer.source;
    const reference = transfer.reference;
    const dl = (color[0] - source.center[0]) / Math.max(0.035, source.spread[0] * 2.4);
    const da = (color[1] - source.center[1]) / Math.max(0.018, source.spread[1] * 2.4);
    const db = (color[2] - source.center[2]) / Math.max(0.018, source.spread[2] * 2.4);
    const membership = Math.exp(-(dl * dl + da * da + db * db) * 0.5) * Math.max(0.08, source.weight);
    const scaleL = clamp(reference.spread[0] / Math.max(0.0001, source.spread[0]), 0.72, 1.38);
    const scaleA = clamp(reference.spread[1] / Math.max(0.0001, source.spread[1]), 0.66, 1.5);
    const scaleB = clamp(reference.spread[2] / Math.max(0.0001, source.spread[2]), 0.66, 1.5);
    outputL += (reference.center[0] + (color[0] - source.center[0]) * scaleL) * membership;
    outputA += (reference.center[1] + (color[1] - source.center[1]) * scaleA) * membership;
    outputB += (reference.center[2] + (color[2] - source.center[2]) * scaleB) * membership;
    totalWeight += membership;
  }
  if (totalWeight < 0.00001) return color;
  const influence = clamp(totalWeight * 4.2, 0, 1);
  return [
    color[0] + (outputL / totalWeight - color[0]) * influence,
    color[1] + (outputA / totalWeight - color[1]) * influence,
    color[2] + (outputB / totalWeight - color[2]) * influence,
  ];
}

function rotationMatrix(x: number, y: number, z: number): Matrix3 {
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

function projectedDistributionMap(source: number[], reference: number[], bins = 192): ProjectedDistributionMap {
  const sourceMin = Math.min(...source);
  const sourceMax = Math.max(sourceMin + 0.000001, ...source);
  const referenceMin = Math.min(...reference);
  const referenceMax = Math.max(referenceMin + 0.000001, ...reference);
  const sourceHistogram = new Float32Array(bins);
  const referenceHistogram = new Float32Array(bins);
  const sourceScale = (bins - 1) / (sourceMax - sourceMin);
  const referenceScale = (bins - 1) / (referenceMax - referenceMin);

  for (const value of source) {
    sourceHistogram[Math.round(clamp((value - sourceMin) * sourceScale, 0, bins - 1))] += 1;
  }
  for (const value of reference) {
    referenceHistogram[Math.round(clamp((value - referenceMin) * referenceScale, 0, bins - 1))] += 1;
  }

  const sourceCdf = new Float32Array(bins);
  const referenceCdf = new Float32Array(bins);
  let sourceTotal = 0;
  let referenceTotal = 0;
  for (let index = 0; index < bins; index += 1) {
    sourceTotal += sourceHistogram[index];
    referenceTotal += referenceHistogram[index];
    sourceCdf[index] = sourceTotal / Math.max(1, source.length);
    referenceCdf[index] = referenceTotal / Math.max(1, reference.length);
  }

  const lookup = new Float32Array(bins);
  let referenceIndex = 0;
  for (let sourceIndex = 0; sourceIndex < bins; sourceIndex += 1) {
    while (
      referenceIndex < bins - 1
      && referenceCdf[referenceIndex] < sourceCdf[sourceIndex]
    ) {
      referenceIndex += 1;
    }
    lookup[sourceIndex] = referenceMin + referenceIndex / (bins - 1) * (referenceMax - referenceMin);
  }
  return { sourceMin, sourceMax, referenceMin, referenceMax, lookup };
}

function applyProjectedMap(value: number, map: ProjectedDistributionMap) {
  const normalized = clamp((value - map.sourceMin) / Math.max(0.000001, map.sourceMax - map.sourceMin));
  const position = normalized * (map.lookup.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(map.lookup.length - 1, lower + 1);
  const mix = position - lower;
  return map.lookup[lower] * (1 - mix) + map.lookup[upper] * mix;
}

function buildPdfTransfer(source: ColorProfile, reference: ColorProfile, iterations = 12): PdfTransferStage[] {
  if (source.samples.length < 8 || reference.samples.length < 8) return [];
  let working = source.samples.map((sample) => [...sample] as [number, number, number]);
  const stages: PdfTransferStage[] = [];
  const golden = 2.399963229728653;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const rotation = rotationMatrix(
      0.31 + iteration * golden * 0.37,
      0.53 + iteration * golden * 0.23,
      0.79 + iteration * golden * 0.41,
    );
    const inverse = transposeMatrix3(rotation);
    const sourceRotated = working.map((sample) => multiplyVector3(rotation, sample));
    const referenceRotated = reference.samples.map((sample) => multiplyVector3(rotation, sample));
    const maps = [0, 1, 2].map((channel) => projectedDistributionMap(
      sourceRotated.map((sample) => sample[channel]),
      referenceRotated.map((sample) => sample[channel]),
    )) as [ProjectedDistributionMap, ProjectedDistributionMap, ProjectedDistributionMap];

    working = sourceRotated.map((sample) => multiplyVector3(inverse, [
      applyProjectedMap(sample[0], maps[0]),
      applyProjectedMap(sample[1], maps[1]),
      applyProjectedMap(sample[2], maps[2]),
    ]));
    stages.push({ rotation, inverse, maps });
  }
  return stages;
}

function applyPdfTransfer(
  value: [number, number, number],
  stages: PdfTransferStage[],
): [number, number, number] {
  let current = value;
  for (const stage of stages) {
    const rotated = multiplyVector3(stage.rotation, current);
    current = multiplyVector3(stage.inverse, [
      applyProjectedMap(rotated[0], stage.maps[0]),
      applyProjectedMap(rotated[1], stage.maps[1]),
      applyProjectedMap(rotated[2], stage.maps[2]),
    ]);
  }
  return current;
}

function buildPdfLut(source: ColorProfile, stages: PdfTransferStage[], size = 17): ColorLut3D | null {
  if (stages.length === 0 || source.samples.length === 0) return null;
  const minimum: [number, number, number] = [1, 1, 1];
  const maximum: [number, number, number] = [0, -1, -1];
  for (const sample of source.samples) {
    for (let channel = 0; channel < 3; channel += 1) {
      minimum[channel] = Math.min(minimum[channel], sample[channel]);
      maximum[channel] = Math.max(maximum[channel], sample[channel]);
    }
  }
  minimum[0] = Math.max(0, minimum[0] - 0.04);
  maximum[0] = Math.min(1, maximum[0] + 0.04);
  minimum[1] -= 0.035;
  maximum[1] += 0.035;
  minimum[2] -= 0.035;
  maximum[2] += 0.035;

  const values = new Float32Array(size * size * size * 3);
  for (let lightness = 0; lightness < size; lightness += 1) {
    for (let a = 0; a < size; a += 1) {
      for (let b = 0; b < size; b += 1) {
        const input: [number, number, number] = [
          minimum[0] + lightness / (size - 1) * (maximum[0] - minimum[0]),
          minimum[1] + a / (size - 1) * (maximum[1] - minimum[1]),
          minimum[2] + b / (size - 1) * (maximum[2] - minimum[2]),
        ];
        const output = applyPdfTransfer(input, stages);
        const index = ((lightness * size + a) * size + b) * 3;
        values[index] = output[0];
        values[index + 1] = output[1];
        values[index + 2] = output[2];
      }
    }
  }
  return { size, minimum, maximum, values };
}

function sampleColorLut(
  value: [number, number, number],
  lut: ColorLut3D,
): [number, number, number] {
  const positions = value.map((channel, index) => (
    clamp(
      (channel - lut.minimum[index]) / Math.max(0.000001, lut.maximum[index] - lut.minimum[index]),
    ) * (lut.size - 1)
  ));
  const lower = positions.map(Math.floor);
  const upper = lower.map((position) => Math.min(lut.size - 1, position + 1));
  const mix = positions.map((position, index) => position - lower[index]);
  const result: [number, number, number] = [0, 0, 0];

  for (let lightness = 0; lightness < 2; lightness += 1) {
    for (let a = 0; a < 2; a += 1) {
      for (let b = 0; b < 2; b += 1) {
        const x = lightness ? upper[0] : lower[0];
        const y = a ? upper[1] : lower[1];
        const z = b ? upper[2] : lower[2];
        const weight = (lightness ? mix[0] : 1 - mix[0])
          * (a ? mix[1] : 1 - mix[1])
          * (b ? mix[2] : 1 - mix[2]);
        const offset = ((x * lut.size + y) * lut.size + z) * 3;
        result[0] += lut.values[offset] * weight;
        result[1] += lut.values[offset + 1] * weight;
        result[2] += lut.values[offset + 2] * weight;
      }
    }
  }
  return result;
}

function shadowWeight(lightness: number) {
  return 1 - smoothstep(0.12, 0.62, lightness);
}

function highlightWeight(lightness: number) {
  return smoothstep(0.42, 0.93, lightness);
}

function midtoneWeight(lightness: number) {
  return smoothstep(0.08, 0.48, lightness) * (1 - smoothstep(0.55, 0.94, lightness));
}

function boxBlur(source: Float32Array, width: number, height: number, radius: number) {
  if (radius <= 0) return source.slice();
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      sum += source[y * width + Math.min(width - 1, Math.max(0, x))];
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / (radius * 2 + 1);
      const removeX = Math.max(0, x - radius);
      const addX = Math.min(width - 1, x + radius + 1);
      sum += source[y * width + addX] - source[y * width + removeX];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / (radius * 2 + 1);
      const removeY = Math.max(0, y - radius);
      const addY = Math.min(height - 1, y + radius + 1);
      sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
    }
  }
  return output;
}

function deterministicNoise(x: number, y: number) {
  const seed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (seed - Math.floor(seed)) * 2 - 1;
}

function applyLocalDetail(
  imageData: ImageData,
  clarity: number,
  sharpness: number,
) {
  if (clarity === 0 && sharpness === 0) return;
  const luminance = new Float32Array(imageData.width * imageData.height);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const index = pixel * 4;
    luminance[pixel] = linearLuminance(
      srgbToLinear(imageData.data[index]),
      srgbToLinear(imageData.data[index + 1]),
      srgbToLinear(imageData.data[index + 2]),
    );
  }
  const clarityBlur = clarity !== 0 ? boxBlur(luminance, imageData.width, imageData.height, 5) : null;
  const sharpBlur = sharpness !== 0 ? boxBlur(luminance, imageData.width, imageData.height, 1) : null;
  const clarityAmount = clarity / 100 * 0.34;
  const sharpnessAmount = Math.max(0, sharpness) / 100 * 0.28;
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const index = pixel * 4;
    const originalLuma = Math.max(0.0001, luminance[pixel]);
    const perceptual = Math.sqrt(originalLuma);
    const protection = midtoneWeight(perceptual);
    let nextLuma = originalLuma;
    if (clarityBlur) nextLuma += (originalLuma - clarityBlur[pixel]) * clarityAmount * protection;
    if (sharpBlur) nextLuma += (originalLuma - sharpBlur[pixel]) * sharpnessAmount;
    const ratio = clamp(nextLuma / originalLuma, 0.72, 1.32);
    imageData.data[index] = linearToSrgb(srgbToLinear(imageData.data[index]) * ratio);
    imageData.data[index + 1] = linearToSrgb(srgbToLinear(imageData.data[index + 1]) * ratio);
    imageData.data[index + 2] = linearToSrgb(srgbToLinear(imageData.data[index + 2]) * ratio);
  }
}

function applyGradientFidelity(
  imageData: ImageData,
  originalLuminance: Float32Array,
  strength: number,
) {
  if (strength <= 0) return;
  const gradedLuminance = new Float32Array(originalLuminance.length);
  for (let pixel = 0; pixel < gradedLuminance.length; pixel += 1) {
    const index = pixel * 4;
    gradedLuminance[pixel] = linearLuminance(
      srgbToLinear(imageData.data[index]),
      srgbToLinear(imageData.data[index + 1]),
      srgbToLinear(imageData.data[index + 2]),
    );
  }
  const sourceBlur = boxBlur(originalLuminance, imageData.width, imageData.height, 2);
  const gradedBlur = boxBlur(gradedLuminance, imageData.width, imageData.height, 2);
  const amount = clamp(strength, 0, 1) * 0.82;

  for (let pixel = 0; pixel < gradedLuminance.length; pixel += 1) {
    const index = pixel * 4;
    const sourceDetail = originalLuminance[pixel] - sourceBlur[pixel];
    const gradedDetail = gradedLuminance[pixel] - gradedBlur[pixel];
    const perceptualLightness = Math.sqrt(Math.max(0, gradedLuminance[pixel]));
    const tonalProtection = smoothstep(0.025, 0.12, perceptualLightness)
      * (1 - smoothstep(0.88, 0.985, perceptualLightness));
    const desiredLuminance = gradedLuminance[pixel]
      + (sourceDetail - gradedDetail) * amount * tonalProtection;
    const ratio = clamp(desiredLuminance / Math.max(0.0001, gradedLuminance[pixel]), 0.78, 1.28);
    imageData.data[index] = linearToSrgb(srgbToLinear(imageData.data[index]) * ratio);
    imageData.data[index + 1] = linearToSrgb(srgbToLinear(imageData.data[index + 1]) * ratio);
    imageData.data[index + 2] = linearToSrgb(srgbToLinear(imageData.data[index + 2]) * ratio);
  }
}

function applyIlluminationMatch(
  imageData: ImageData,
  originalLuminance: Float32Array,
  sourceLocalContrast: number,
  referenceLocalContrast: number,
  strength: number,
) {
  const gradedLuminance = new Float32Array(originalLuminance.length);
  for (let pixel = 0; pixel < gradedLuminance.length; pixel += 1) {
    const index = pixel * 4;
    gradedLuminance[pixel] = linearLuminance(
      srgbToLinear(imageData.data[index]),
      srgbToLinear(imageData.data[index + 1]),
      srgbToLinear(imageData.data[index + 2]),
    );
  }
  const radius = Math.max(4, Math.min(14, Math.round(Math.min(imageData.width, imageData.height) / 45)));
  const gradedBase = boxBlur(gradedLuminance, imageData.width, imageData.height, radius);
  const contrastRatio = clamp(referenceLocalContrast / Math.max(0.00001, sourceLocalContrast), 0.68, 1.55);
  const amount = clamp(strength, 0, 1);

  for (let pixel = 0; pixel < gradedLuminance.length; pixel += 1) {
    const index = pixel * 4;
    const detail = gradedLuminance[pixel] - gradedBase[pixel];
    const desired = clamp(gradedBase[pixel] + detail * (1 + (contrastRatio - 1) * amount));
    const ratio = clamp(desired / Math.max(0.0001, gradedLuminance[pixel]), 0.72, 1.38);
    imageData.data[index] = linearToSrgb(srgbToLinear(imageData.data[index]) * ratio);
    imageData.data[index + 1] = linearToSrgb(srgbToLinear(imageData.data[index + 1]) * ratio);
    imageData.data[index + 2] = linearToSrgb(srgbToLinear(imageData.data[index + 2]) * ratio);
  }
}

function gradeTile(
  imageData: ImageData,
  originX: number,
  originY: number,
  fullWidth: number,
  fullHeight: number,
  sourceProfile: ColorProfile,
  referenceProfile: ColorProfile | null,
  transforms: ColorTransferTransforms | null,
  settings: ColorGradeSettings,
  applySpatial = true,
) {
  const effectiveMethod = settings.matchMethod === 'auto' ? settings.autoMethod : settings.matchMethod;
  const overallMatch = settings.matchStrength / 100;
  const luminanceMatch = overallMatch * settings.luminanceMatch / 100;
  const colorMatch = overallMatch * settings.colorMatch / 100;
  const contrastMatch = overallMatch * settings.contrastMatch / 100;
  const referencePercentiles = referenceProfile
    ? protectedReferencePercentiles(
      sourceProfile.percentiles,
      referenceProfile.percentiles,
      settings.matchMethod === 'auto' ? overallMatch : overallMatch * 0.78,
    )
    : null;
  const multivariateTransform = transforms?.multivariate || null;
  const optimalTransport = transforms?.optimal || null;
  const contrastRatio = referenceProfile
    ? clamp(referenceProfile.stdY / sourceProfile.stdY, 0.68, 1.52)
    : 1;
  const colorSpreadA = referenceProfile ? clamp(referenceProfile.stdA / sourceProfile.stdA, 0.72, 1.42) : 1;
  const colorSpreadB = referenceProfile ? clamp(referenceProfile.stdB / sourceProfile.stdB, 0.72, 1.42) : 1;
  const exposureMultiplier = Math.pow(2, clamp(settings.exposure, -2, 2));
  const contrastFactor = Math.pow(2, clamp(settings.contrast, -100, 100) / 220);
  const gammaExponent = Math.pow(2, -clamp(settings.gamma, -100, 100) / 220);
  const saturationFactor = clamp(1 + settings.saturation / 100 * 0.58, 0.35, 1.58);
  const shadowDirection = colorDirection(settings.shadowColor);
  const midtoneDirection = colorDirection(settings.midtoneColor);
  const highlightDirection = colorDirection(settings.highlightColor);
  const originalLuminance = settings.detailProtection > 0 || Boolean(referenceProfile)
    ? new Float32Array(imageData.width * imageData.height)
    : null;

  for (let index = 0; index < imageData.data.length; index += 4) {
    if (imageData.data[index + 3] === 0) continue;
    const sourceRed = srgbToLinear(imageData.data[index]);
    const sourceGreen = srgbToLinear(imageData.data[index + 1]);
    const sourceBlue = srgbToLinear(imageData.data[index + 2]);
    if (originalLuminance) {
      originalLuminance[index / 4] = linearLuminance(sourceRed, sourceGreen, sourceBlue);
    }
    const sourceLab = linearRgbToOklab(sourceRed, sourceGreen, sourceBlue);
    const sourceChroma = Math.sqrt(sourceLab.a * sourceLab.a + sourceLab.b * sourceLab.b);
    let red = sourceRed * exposureMultiplier;
    let green = sourceGreen * exposureMultiplier;
    let blue = sourceBlue * exposureMultiplier;
    let lab = linearRgbToOklab(red, green, blue);

    if (referenceProfile && referencePercentiles) {
      const mappedLightness = smoothToneMap(lab.l, sourceProfile.percentiles, referencePercentiles);
      const reinhardLightness = referenceProfile.meanY + (lab.l - sourceProfile.meanY) * contrastRatio;
      const reinhardA = referenceProfile.meanA + (lab.a - sourceProfile.meanA) * colorSpreadA;
      const reinhardB = referenceProfile.meanB + (lab.b - sourceProfile.meanB) * colorSpreadB;
      const distributed = multivariateTransform
        ? multiplyVector3(multivariateTransform, [
          lab.l - sourceProfile.meanY,
          lab.a - sourceProfile.meanA,
          lab.b - sourceProfile.meanB,
        ])
        : [lab.l - sourceProfile.meanY, lab.a - sourceProfile.meanA, lab.b - sourceProfile.meanB] as [number, number, number];
      const distributedLightness = referenceProfile.meanY + distributed[0];
      const distributedA = referenceProfile.meanA + distributed[1];
      const distributedB = referenceProfile.meanB + distributed[2];
      const optimal = optimalTransport
        ? multiplyVector3(optimalTransport, [
          lab.l - sourceProfile.meanY,
          lab.a - sourceProfile.meanA,
          lab.b - sourceProfile.meanB,
        ])
        : distributed;
      const optimalLightness = referenceProfile.meanY + optimal[0];
      const optimalA = referenceProfile.meanA + optimal[1];
      const optimalB = referenceProfile.meanB + optimal[2];
      const pdf = transforms?.pdf
        ? sampleColorLut([lab.l, lab.a, lab.b], transforms.pdf)
        : [lab.l, lab.a, lab.b] as [number, number, number];
      const clustered = transforms?.clusters
        ? applyClusterTransfer([lab.l, lab.a, lab.b], transforms.clusters)
        : [lab.l, lab.a, lab.b] as [number, number, number];

      if (effectiveMethod === 'histogram') {
        lab.l += (mappedLightness - lab.l) * luminanceMatch;
        lab.a += (reinhardA - lab.a) * colorMatch * 0.42;
        lab.b += (reinhardB - lab.b) * colorMatch * 0.42;
      } else if (effectiveMethod === 'reinhard') {
        lab.l += (reinhardLightness - lab.l) * luminanceMatch * 0.78;
        lab.a += (reinhardA - lab.a) * colorMatch * 0.58;
        lab.b += (reinhardB - lab.b) * colorMatch * 0.58;
      } else if (effectiveMethod === 'distribution') {
        lab.l += (distributedLightness - lab.l) * luminanceMatch * 0.62;
        lab.a += (distributedA - lab.a) * colorMatch * 0.52;
        lab.b += (distributedB - lab.b) * colorMatch * 0.52;
      } else if (effectiveMethod === 'hybrid') {
        const hybridLightness = mappedLightness * 0.62 + distributedLightness * 0.38;
        const hybridA = reinhardA * 0.46 + distributedA * 0.54;
        const hybridB = reinhardB * 0.46 + distributedB * 0.54;
        lab.l += (hybridLightness - lab.l) * luminanceMatch * 0.92;
        lab.a += (hybridA - lab.a) * colorMatch * 0.68;
        lab.b += (hybridB - lab.b) * colorMatch * 0.68;
        lab.l += (clustered[0] - lab.l) * luminanceMatch * 0.28;
        lab.a += (clustered[1] - lab.a) * colorMatch * 0.44;
        lab.b += (clustered[2] - lab.b) * colorMatch * 0.44;
        const finalTonePass = smoothToneMap(lab.l, sourceProfile.percentiles, referencePercentiles);
        lab.l += (finalTonePass - lab.l) * luminanceMatch * 0.16;
      } else if (effectiveMethod === 'lab') {
        const labLightness = mappedLightness * 0.34 + optimalLightness * 0.66;
        const labA = reinhardA * 0.22 + optimalA * 0.78;
        const labB = reinhardB * 0.22 + optimalB * 0.78;
        lab.l += (labLightness - lab.l) * luminanceMatch * 0.94;
        lab.a += (labA - lab.a) * colorMatch * 0.78;
        lab.b += (labB - lab.b) * colorMatch * 0.78;
        lab.l += (clustered[0] - lab.l) * luminanceMatch * 0.25;
        lab.a += (clustered[1] - lab.a) * colorMatch * 0.42;
        lab.b += (clustered[2] - lab.b) * colorMatch * 0.42;
        const finalTonePass = smoothToneMap(lab.l, sourceProfile.percentiles, referencePercentiles);
        lab.l += (finalTonePass - lab.l) * luminanceMatch * 0.12;
      } else if (effectiveMethod === 'pdf') {
        lab.l += (pdf[0] - lab.l) * luminanceMatch * 0.92;
        lab.a += (pdf[1] - lab.a) * colorMatch * 0.78;
        lab.b += (pdf[2] - lab.b) * colorMatch * 0.78;
        lab.l += (clustered[0] - lab.l) * luminanceMatch * 0.24;
        lab.a += (clustered[1] - lab.a) * colorMatch * 0.45;
        lab.b += (clustered[2] - lab.b) * colorMatch * 0.45;
        const finalTonePass = smoothToneMap(lab.l, sourceProfile.percentiles, referencePercentiles);
        lab.l += (finalTonePass - lab.l) * luminanceMatch * 0.12;
      } else {
        lab.l += (mappedLightness - lab.l) * luminanceMatch;
        lab.a += (reinhardA - lab.a) * colorMatch * 0.52;
        lab.b += (reinhardB - lab.b) * colorMatch * 0.52;
      }
      const contrastLightness = referenceProfile.percentiles[4] + (lab.l - sourceProfile.percentiles[4]) * contrastRatio;
      lab.l += (contrastLightness - lab.l) * contrastMatch * 0.36;
    }

    lab.l += settings.brightness / 100 * 0.085;
    const pivot = 0.5;
    lab.l = pivot + (lab.l - pivot) * contrastFactor;
    lab.l = Math.pow(clamp(lab.l), gammaExponent);

    const shadows = shadowWeight(lab.l);
    const highlights = highlightWeight(lab.l);
    const midtones = midtoneWeight(lab.l);
    lab.l += settings.shadows / 100 * 0.095 * shadows;
    lab.l += settings.highlights / 100 * 0.075 * highlights;
    lab.l += settings.blacks / 100 * 0.04 * shadows * shadows;
    lab.l += settings.whites / 100 * 0.04 * highlights * highlights;
    lab.l = softBound(lab.l);

    const temperature = settings.temperature / 100;
    const tint = settings.tint / 100;
    lab.a += temperature * 0.008 + tint * 0.022;
    lab.b += temperature * 0.03 - tint * 0.006;

    const chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    const vibranceProtection = 1 - smoothstep(0.03, 0.24, chroma);
    const vibranceFactor = clamp(1 + settings.vibrance / 100 * 0.45 * vibranceProtection, 0.55, 1.45);
    const chromaFactor = saturationFactor * vibranceFactor;
    lab.a *= chromaFactor;
    lab.b *= chromaFactor;

    lab.a += shadowDirection.a * settings.shadowColorStrength / 100 * 0.028 * shadows;
    lab.b += shadowDirection.b * settings.shadowColorStrength / 100 * 0.028 * shadows;
    lab.a += midtoneDirection.a * settings.midtoneColorStrength / 100 * 0.024 * midtones;
    lab.b += midtoneDirection.b * settings.midtoneColorStrength / 100 * 0.024 * midtones;
    lab.a += highlightDirection.a * settings.highlightColorStrength / 100 * 0.024 * highlights;
    lab.b += highlightDirection.b * settings.highlightColorStrength / 100 * 0.024 * highlights;

    if (settings.fade > 0) {
      const fade = settings.fade / 100;
      lab.l = lab.l * (1 - fade * 0.12) + 0.085 * fade;
      lab.a *= 1 - fade * 0.08;
      lab.b *= 1 - fade * 0.08;
    }

    lab.l = clamp(lab.l, Math.max(0.008, sourceLab.l - 0.32), Math.min(0.992, sourceLab.l + 0.32));
    const finalChroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    const maximumChroma = Math.min(0.3, sourceChroma * 2.05 + 0.075);
    if (finalChroma > maximumChroma) {
      const chromaScale = maximumChroma / Math.max(0.0001, finalChroma);
      lab.a *= chromaScale;
      lab.b *= chromaScale;
    }

    ({ red, green, blue } = gamutMapOklab(lab.l, lab.a, lab.b));
    const pixel = index / 4;
    const x = originX + pixel % imageData.width;
    const y = originY + Math.floor(pixel / imageData.width);
    if (settings.vignette !== 0) {
      const normalizedX = (x / fullWidth - 0.5) * 2;
      const normalizedY = (y / fullHeight - 0.5) * 2;
      const distance = Math.min(1, Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY));
      const vignette = settings.vignette / 100;
      const multiplier = clamp(1 - vignette * Math.pow(distance, 1.8) * 0.48, 0.55, 1.45);
      red *= multiplier;
      green *= multiplier;
      blue *= multiplier;
    }
    if (settings.grain > 0) {
      const noise = deterministicNoise(x, y) * settings.grain / 100 * 0.018;
      red += noise;
      green += noise;
      blue += noise;
    }

    imageData.data[index] = linearToSrgb(clamp(softBound(red), 0.002, 0.985));
    imageData.data[index + 1] = linearToSrgb(clamp(softBound(green), 0.002, 0.985));
    imageData.data[index + 2] = linearToSrgb(clamp(softBound(blue), 0.002, 0.985));
  }
  if (applySpatial && originalLuminance && referenceProfile) {
    applyIlluminationMatch(
      imageData,
      originalLuminance,
      sourceProfile.localContrast,
      referenceProfile.localContrast,
      luminanceMatch * 0.72,
    );
  }
  if (applySpatial && originalLuminance && settings.detailProtection > 0) {
    const gradientStrength = settings.detailProtection / 100
      * (effectiveMethod === 'lab' || effectiveMethod === 'pdf' ? 0.9 : 0.56);
    applyGradientFidelity(imageData, originalLuminance, gradientStrength);
  }
  if (applySpatial) applyLocalDetail(imageData, settings.clarity, settings.sharpness);
}

export async function buildColorGradeLutRecipe(
  target: ImageState,
  reference: ImageState | null,
  settings: ColorGradeSettings,
  diagnostics?: ColorGradeDiagnostics | null,
  size = 17,
): Promise<ColorGradeLutRecipe> {
  const [targetProfile, referenceProfile] = await Promise.all([
    analyzeColorProfile(target),
    reference && getImageSrc(reference) ? analyzeColorProfile(reference) : Promise.resolve<ColorProfile | null>(null),
  ]);
  const effectiveMethod = settings.matchMethod === 'auto' ? settings.autoMethod : settings.matchMethod;
  const pdfStages = referenceProfile && effectiveMethod === 'pdf'
    ? buildPdfTransfer(targetProfile, referenceProfile)
    : [];
  const transforms: ColorTransferTransforms | null = referenceProfile
    ? {
      multivariate: distributionTransform(targetProfile, referenceProfile),
      optimal: mongeKantorovichTransform(targetProfile, referenceProfile),
      pdf: effectiveMethod === 'pdf' ? buildPdfLut(targetProfile, pdfStages) : null,
      clusters: buildClusterTransfers(targetProfile, referenceProfile),
    }
    : null;
  const width = size * size;
  const height = size;
  const imageData = new ImageData(width, height);
  for (let blueIndex = 0; blueIndex < size; blueIndex += 1) {
    for (let greenIndex = 0; greenIndex < size; greenIndex += 1) {
      for (let redIndex = 0; redIndex < size; redIndex += 1) {
        const x = blueIndex * size + greenIndex;
        const y = redIndex;
        const index = (y * width + x) * 4;
        imageData.data[index] = Math.round(redIndex / (size - 1) * 255);
        imageData.data[index + 1] = Math.round(greenIndex / (size - 1) * 255);
        imageData.data[index + 2] = Math.round(blueIndex / (size - 1) * 255);
        imageData.data[index + 3] = 255;
      }
    }
  }
  gradeTile(
    imageData,
    0,
    0,
    width,
    height,
    targetProfile,
    referenceProfile,
    transforms,
    { ...settings, clarity: 0, sharpness: 0, vignette: 0, grain: 0, detailProtection: 0 },
    false,
  );
  const data: number[] = [];
  for (let blueIndex = 0; blueIndex < size; blueIndex += 1) {
    for (let greenIndex = 0; greenIndex < size; greenIndex += 1) {
      for (let redIndex = 0; redIndex < size; redIndex += 1) {
        const x = blueIndex * size + greenIndex;
        const y = redIndex;
        const index = (y * width + x) * 4;
        data.push(
          imageData.data[index] / 255,
          imageData.data[index + 1] / 255,
          imageData.data[index + 2] / 255,
        );
      }
    }
  }
  return {
    version: COLOR_GRADE_ENGINE_VERSION,
    size,
    data,
    settings: { ...settings },
    diagnostics: diagnostics || null,
  };
}

export async function renderColorGrade(
  target: ImageState,
  reference: ImageState | null,
  settings: ColorGradeSettings,
  maxEdge?: number,
): Promise<ColorGradeRenderResult> {
  const [targetImage, referenceProfile] = await Promise.all([
    loadImage(target),
    reference && getImageSrc(reference) ? analyzeColorProfile(reference) : Promise.resolve<ColorProfile | null>(null),
  ]);
  const canvas = imageToCanvas(targetImage, maxEdge);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const sourceProfile = profileCanvas(canvas);
  const effectiveMethod = settings.matchMethod === 'auto' ? settings.autoMethod : settings.matchMethod;
  const pdfStages = referenceProfile && effectiveMethod === 'pdf'
    ? buildPdfTransfer(sourceProfile, referenceProfile)
    : [];
  const transforms: ColorTransferTransforms | null = referenceProfile
    ? {
      multivariate: distributionTransform(sourceProfile, referenceProfile),
      optimal: mongeKantorovichTransform(sourceProfile, referenceProfile),
      pdf: effectiveMethod === 'pdf' ? buildPdfLut(sourceProfile, pdfStages) : null,
      clusters: buildClusterTransfers(sourceProfile, referenceProfile),
    }
    : null;
  const detailPadding = referenceProfile
    ? 18
    : settings.clarity !== 0
      ? 6
      : settings.sharpness !== 0
        ? 2
        : 0;

  for (let tileY = 0; tileY < canvas.height; tileY += TILE_SIZE) {
    for (let tileX = 0; tileX < canvas.width; tileX += TILE_SIZE) {
      const tileWidth = Math.min(TILE_SIZE, canvas.width - tileX);
      const tileHeight = Math.min(TILE_SIZE, canvas.height - tileY);
      const readX = Math.max(0, tileX - detailPadding);
      const readY = Math.max(0, tileY - detailPadding);
      const readRight = Math.min(canvas.width, tileX + tileWidth + detailPadding);
      const readBottom = Math.min(canvas.height, tileY + tileHeight + detailPadding);
      const imageData = context.getImageData(readX, readY, readRight - readX, readBottom - readY);
      gradeTile(imageData, readX, readY, canvas.width, canvas.height, sourceProfile, referenceProfile, transforms, settings);
      context.putImageData(
        imageData,
        readX,
        readY,
        tileX - readX,
        tileY - readY,
        tileWidth,
        tileHeight,
      );
    }
  }
  return { canvas, profile: profileCanvas(canvas) };
}

export function canvasToImageState(canvas: HTMLCanvasElement, fileName: string, format: 'png' | 'jpeg', quality = 0.96): ImageState {
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = canvas.toDataURL(mimeType, quality);
  return {
    fileName,
    base64: dataUrl.split(',')[1] || null,
    mimeType,
    width: canvas.width,
    height: canvas.height,
    assetPath: null,
    assetUrl: null,
  };
}
