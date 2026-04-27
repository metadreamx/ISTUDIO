import React, { useState, useCallback } from 'react';
import { Upload, ImageIcon, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

interface ImageUploaderProps {
  onUpload: (files: File[]) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onUpload }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((file: File) => file.type.startsWith('image/'));
    if (files.length > 0) onUpload(files);
  }, [onUpload]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      if (files.length > 0) onUpload(files);
    }
  }, [onUpload]);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-2xl mx-auto"
    >
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-upload-main')?.click()}
        className={`relative group cursor-pointer aspect-[16/9] rounded-3xl border-2 border-dashed transition-all duration-500 flex flex-col items-center justify-center p-12 overflow-hidden ${
          isDragging 
            ? 'border-indigo-500 bg-indigo-500/5 scale-[1.02]' 
            : 'border-zinc-800 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/50'
        }`}
      >
        {/* Decorative Background Elements */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute top-0 left-0 w-full h-full grid grid-cols-8 grid-rows-8 gap-4 p-4">
            {Array.from({ length: 64 }).map((_, i) => (
              <div key={i} className="w-1 h-1 bg-zinc-500 rounded-full opacity-20" />
            ))}
          </div>
        </div>

        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-zinc-800 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-indigo-600 transition-all duration-500 shadow-2xl">
            <Upload className="w-8 h-8 text-zinc-400 group-hover:text-white transition-colors" />
          </div>
          
          <h2 className="text-3xl font-black tracking-tight text-white mb-3">
            Drop your creative vision
          </h2>
          <p className="text-zinc-500 text-lg max-w-md mx-auto leading-relaxed">
            Upload images to transform them with AI. Supports batch processing for high-volume workflows.
          </p>

          <div className="mt-8 flex items-center gap-4">
            <div className="flex -space-x-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="w-10 h-10 rounded-full border-2 border-zinc-900 bg-zinc-800 flex items-center justify-center">
                  <ImageIcon className="w-4 h-4 text-zinc-500" />
                </div>
              ))}
            </div>
            <span className="text-sm font-medium text-zinc-400">
              Join 10k+ creators
            </span>
          </div>
        </div>

        {/* Action Button Overlay */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-4 group-hover:translate-y-0">
          <button className="px-8 py-3 bg-white text-zinc-950 rounded-full font-bold flex items-center gap-2 shadow-xl hover:scale-105 transition-transform">
            <Sparkles className="w-4 h-4" />
            Select Files
          </button>
        </div>
      </div>

      <input 
        id="file-upload-main"
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="mt-12 grid grid-cols-3 gap-6">
        {[
          { icon: Sparkles, title: 'AI Enhanced', desc: 'Advanced style transfer' },
          { icon: ImageIcon, title: 'Batch Ready', desc: 'Process 100+ images' },
          { icon: Upload, title: 'Fast Export', desc: 'High-res downloads' }
        ].map((feature, i) => (
          <div key={i} className="flex flex-col items-center text-center p-4">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center mb-3 border border-zinc-800">
              <feature.icon className="w-5 h-5 text-indigo-400" />
            </div>
            <h3 className="font-bold text-sm text-white mb-1">{feature.title}</h3>
            <p className="text-xs text-zinc-500 leading-tight">{feature.desc}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
};
