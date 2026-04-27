

// --- Digital Twin Creator Specific Types ---

export interface Target {
  id: string;
  base64: string;
}

export interface ClothingSource {
  id: string;
  base64: string;
  mimeType: string;
  analyzing: boolean;
}

export interface AnalyzedItem {
  id: string;
  sourceId: string;
  name: string;
  selected: boolean;
}

export interface BackgroundItem {
  image: {
    base64: string | null;
    mimeType: string | null;
  };
  analysis: string | null;
  status: 'empty' | 'analyzing' | 'ready' | 'error';
}

export interface RenderHistoryItem {
  imageB64: string;
  prompt: string;
}

export type ProcessStage = 'initial' | 'analyzing_target' | 'ready' | 'rendering' | 'done' | 'error';

export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export type EnhanceMode = 'deblur' | 'restore' | 'refocus';

export interface AppState {
    targets: Target[];
    clothingSources: ClothingSource[];
    items: AnalyzedItem[];
    background: BackgroundItem;
    subjectDna: SubjectDna | null;
    renderHistory: RenderHistoryItem[];
    renderHistoryIndex: number;
    prompt: string;
    activePreset: string;
    autoSelectItems: boolean;
    isSceneLocked: boolean;
    lockedSceneDescription: string | null;
    isStyleLocked: boolean;
    lockedStyleDescription: string | null;
    isPoseLocked: boolean;
    aspectRatio: AspectRatio | undefined;
    currentStage: ProcessStage;
    errorMessage: string | null;
}

// From Gemini schema
export interface SubjectDna {
    subject_dna: {
      pose: string;
      camera_angle: string;
      framing: string;
      body_position: string;
      skin_tone_notes: string;
      face_geometry: {
        overall_shape: string;
        forehead: string;
        brow_ridge: string;
        eyes: {
          shape: string;
          spacing: string;
          lid_fold: string;
          apparent_color: string;
        };
        nose: {
          bridge: string;
          tip: string;
          nostrils: string;
          width: string;
        };
        cheeks: string;
        lips: {
          fullness: string;
          shape: string;
        };
        teeth?: string;
        chin_jaw: {
          chin: string;
          jawline: string;
        };
      };
      hair: {
        length: string;
        part: string;
        texture: string;
        volume: string;
      };
      facial_hair: string;
      ears: string;
      neck_shoulders: string;
      clothing_baseline: {
        top: string;
        outerwear: string;
        details: string;
      };
      background_baseline: string;
      lighting_baseline: {
        type: string;
        direction: string;
        intensity: string;
        contrast: string;
        color_temp: string;
      };
      image_quality_notes: {
        sharpness: string;
        noise: string;
        exposure: string;
      };
    };
}