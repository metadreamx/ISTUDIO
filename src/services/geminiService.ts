
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import type { StyleCategory, ImageState, StyleItem } from '../types';

const getAiClient = () => {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable not set");
  }
  return new GoogleGenAI({ apiKey: API_KEY });
};

const ANALYSIS_MODEL = 'gemini-3-flash-preview';
const GENERATION_MODEL = 'gemini-3.1-flash-image-preview';

/**
 * Converts a Blob or File to a base64 string
 */
export const fileToBase64 = (file: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Fetches a URL and converts it to base64
 */
export const urlToBase64 = async (url: string): Promise<{ base64: string; mimeType: string }> => {
  const response = await fetch(url);
  const blob = await response.blob();
  const base64 = await fileToBase64(blob);
  return { base64, mimeType: blob.type };
};

/**
 * Processes an image with a style prompt using Gemini
 */
export async function processImage(imageUrl: string, prompt: string): Promise<string> {
  const ai = getAiClient();
  const { base64, mimeType } = await urlToBase64(imageUrl);

  const imagePart = {
    inlineData: {
      data: base64,
      mimeType: mimeType,
    },
  };

  const fullPrompt = `Transform this image based on the following styles: ${prompt}. 
  CRITICAL: DO NOT change the subject's position, pose, or anatomy. 
  The subject's head position, arm positions, body posture, and facial features MUST remain exactly as they are in the original photo. 
  This is a tool for photographers to edit their existing shots, so preserving the original subject's pose is mandatory. 
  Only transform the aesthetic, lighting, colors, and background while keeping the subject's physical state identical.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image', // Using 2.5 flash image for transformation
    contents: {
      parts: [
        imagePart,
        { text: fullPrompt }
      ]
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
      }
    }
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }

  throw new Error("No image generated");
}

/**
 * Analyzes an image to extract style elements
 */
export async function analyzeStyle(imageUrl: string): Promise<StyleCategory[]> {
  const ai = getAiClient();
  const { base64, mimeType } = await urlToBase64(imageUrl);

  const imagePart = {
    inlineData: {
      data: base64,
      mimeType: mimeType,
    },
  };

  const response = await ai.models.generateContent({
    model: ANALYSIS_MODEL,
    contents: {
      parts: [
        imagePart,
        { text: "Analyze this image and extract its visual DNA. Deconstruct it into categories like Lighting, Color, Texture, Composition, and Subject. For each category, provide a list of specific, transferable style elements with a name and description. Return the result as a JSON array of categories." }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  name: { type: Type.STRING },
                  description: { type: Type.STRING }
                },
                required: ["id", "name", "description"]
              }
            }
          },
          required: ["id", "name", "items"]
        }
      }
    }
  });

  return JSON.parse(response.text);
}
