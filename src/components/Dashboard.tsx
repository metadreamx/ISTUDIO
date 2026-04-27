import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  History, 
  Settings, 
  ChevronLeft, 
  Image as ImageIcon,
  Sparkles,
  Download,
  Trash2,
  LayoutGrid,
  Layers,
  Palette
} from 'lucide-react';
import { ImageUploader } from './ImageUploader';
import { StyleChecklist } from './StyleChecklist';
import { MainPanel } from './MainPanel';
import { ProjectState, BatchImage, StyleCategory } from '../types';
import { processImage, analyzeStyle } from '../services/geminiService';

const DEFAULT_CATEGORIES: StyleCategory[] = [
  {
    id: 'lighting',
    name: 'Lighting',
    items: [
      { id: 'cinematic', name: 'Cinematic', description: 'Dramatic lighting with high contrast' },
      { id: 'soft', name: 'Soft', description: 'Gentle, diffused lighting' },
      { id: 'neon', name: 'Neon', description: 'Vibrant, glowing colors' },
      { id: 'natural', name: 'Natural', description: 'Realistic daylight' }
    ]
  },
  {
    id: 'art-style',
    name: 'Art Style',
    items: [
      { id: 'photorealistic', name: 'Photorealistic', description: 'Looks like a real photo' },
      { id: 'oil-painting', name: 'Oil Painting', description: 'Classical painted texture' },
      { id: 'cyberpunk', name: 'Cyberpunk', description: 'Futuristic, high-tech aesthetic' },
      { id: 'minimalist', name: 'Minimalist', description: 'Clean and simple' }
    ]
  }
];

export const Dashboard: React.FC = () => {
  const [project, setProject] = useState<ProjectState>({
    id: crypto.randomUUID(),
    name: 'Untitled Project',
    images: [],
    selectedStyles: [],
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const activeImage = project.images.find(img => img.id === activeImageId) || null;

  const handleUpload = (files: File[]) => {
    const newImages: BatchImage[] = files.map(file => ({
      id: crypto.randomUUID(),
      originalUrl: URL.createObjectURL(file),
      status: 'idle'
    }));

    setProject(prev => ({
      ...prev,
      images: [...prev.images, ...newImages],
      updatedAt: Date.now()
    }));

    if (!activeImageId && newImages.length > 0) {
      setActiveImageId(newImages[0].id);
    }
  };

  const handleStyleToggle = (styleId: string) => {
    setProject(prev => {
      const isSelected = prev.selectedStyles.includes(styleId);
      return {
        ...prev,
        selectedStyles: isSelected 
          ? prev.selectedStyles.filter(id => id !== styleId)
          : [...prev.selectedStyles, styleId],
        updatedAt: Date.now()
      };
    });
  };

  const handleProcess = async () => {
    if (project.images.length === 0) return;

    setProject(prev => ({ ...prev, status: 'processing' }));

    try {
      const updatedImages = await Promise.all(project.images.map(async (img) => {
        if (img.status === 'completed') return img;
        
        // In a real app, we'd pass the actual image data
        // For now, we simulate the process
        const result = await processImage(img.originalUrl, project.selectedStyles.join(', '));
        
        return {
          ...img,
          styledUrl: result,
          status: 'completed' as const
        };
      }));

      setProject(prev => ({
        ...prev,
        images: updatedImages,
        status: 'completed',
        updatedAt: Date.now()
      }));
    } catch (error) {
      console.error('Processing failed:', error);
      setProject(prev => ({ ...prev, status: 'error' }));
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-200 overflow-hidden font-sans">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 320 : 0 }}
        className="border-r border-zinc-800 bg-zinc-900/50 backdrop-blur-xl relative z-20"
      >
        <div className="w-[320px] h-full flex flex-col">
          <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <h1 className="font-bold text-lg tracking-tight">iStudio</h1>
            </div>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-8">
            {/* Project Info */}
            <section>
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 block">
                Project
              </label>
              <input 
                type="text"
                value={project.name}
                onChange={(e) => setProject(prev => ({ ...prev, name: e.target.value }))}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </section>

            {/* Style Selection */}
            <section>
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 block">
                Styles
              </label>
              <StyleChecklist 
                categories={DEFAULT_CATEGORIES}
                selectedIds={project.selectedStyles}
                onToggle={handleStyleToggle}
              />
            </section>

            {/* Batch List */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block">
                  Batch ({project.images.length})
                </label>
                <button className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {project.images.map(img => (
                  <button
                    key={img.id}
                    onClick={() => setActiveImageId(img.id)}
                    className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                      activeImageId === img.id ? 'border-indigo-500 scale-95' : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={img.originalUrl} className="w-full h-full object-cover" alt="" />
                  </button>
                ))}
                <button 
                  onClick={() => document.getElementById('file-upload')?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-zinc-700 flex items-center justify-center hover:border-zinc-500 hover:bg-zinc-800/50 transition-all"
                >
                  <Plus className="w-6 h-4 text-zinc-500" />
                </button>
              </div>
            </section>
          </div>

          <div className="p-4 border-t border-zinc-800">
            <button
              onClick={handleProcess}
              disabled={project.images.length === 0 || project.status === 'processing'}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              {project.status === 'processing' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate Batch
                </>
              )}
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col min-w-0">
        {!isSidebarOpen && (
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-6 left-6 z-30 p-2 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
        )}

        {project.images.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <ImageUploader onUpload={handleUpload} />
          </div>
        ) : (
          <MainPanel 
            image={activeImage}
            onClose={() => setActiveImageId(null)}
          />
        )}

        {/* Floating Toolbar */}
        <AnimatePresence>
          {activeImage && (
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30"
            >
              <div className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-2xl p-2 flex items-center gap-1 shadow-2xl">
                <button className="p-3 hover:bg-zinc-800 rounded-xl transition-colors group relative">
                  <Download className="w-5 h-5" />
                  <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-zinc-800 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Download Styled
                  </span>
                </button>
                <div className="w-px h-6 bg-zinc-800 mx-1" />
                <button className="p-3 hover:bg-zinc-800 rounded-xl transition-colors group relative">
                  <Layers className="w-5 h-5" />
                  <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-zinc-800 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Compare
                  </span>
                </button>
                <button className="p-3 hover:bg-zinc-800 rounded-xl transition-colors group relative">
                  <Palette className="w-5 h-5" />
                  <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-zinc-800 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Edit Styles
                  </span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <input 
        id="file-upload"
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleUpload(Array.from(e.target.files));
        }}
      />
    </div>
  );
};
