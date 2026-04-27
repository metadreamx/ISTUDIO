import React, { useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { 
  Maximize2, 
  Minimize2, 
  RotateCcw, 
  Download, 
  Share2, 
  Trash2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BatchImage } from '../types';

interface MainPanelProps {
  image: BatchImage | null;
  onClose: () => void;
}

export const MainPanel: React.FC<MainPanelProps> = ({ image, onClose }) => {
  const [showOriginal, setShowOriginal] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  if (!image) return null;

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden relative">
      {/* Top Toolbar */}
      <div className="h-16 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-xl px-6 flex items-center justify-between relative z-20">
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex flex-col">
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              Image ID
            </span>
            <span className="text-sm font-mono text-zinc-300">
              {image.id.slice(0, 8)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onMouseDown={() => setShowOriginal(true)}
            onMouseUp={() => setShowOriginal(false)}
            onMouseLeave={() => setShowOriginal(false)}
            className={`p-2 rounded-lg transition-all flex items-center gap-2 px-4 font-bold text-sm ${
              showOriginal 
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
          >
            {showOriginal ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            Original
          </button>
          <div className="h-4 w-px bg-zinc-800 mx-2" />
          <button className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors">
            <Share2 className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors">
            <Download className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-red-500/10 rounded-lg text-zinc-400 hover:text-red-400 transition-colors">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div className="flex-1 relative bg-zinc-950 checkerboard-bg overflow-hidden">
        <TransformWrapper
          initialScale={1}
          centerOnInit
          minScale={0.1}
          maxScale={10}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <div className="absolute top-6 right-6 z-20 flex flex-col gap-2">
                <button 
                  onClick={() => zoomIn()}
                  className="p-3 bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-xl hover:bg-zinc-800 transition-colors shadow-2xl"
                >
                  <Maximize2 className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => zoomOut()}
                  className="p-3 bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-xl hover:bg-zinc-800 transition-colors shadow-2xl"
                >
                  <Minimize2 className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => resetTransform()}
                  className="p-3 bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-xl hover:bg-zinc-800 transition-colors shadow-2xl"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
              </div>

              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <div className="relative max-w-[90%] max-h-[90%] shadow-2xl rounded-2xl overflow-hidden border border-zinc-800 group">
                  <AnimatePresence mode="wait">
                    {showOriginal || !image.styledUrl ? (
                      <motion.img
                        key="original"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        src={image.originalUrl}
                        className="w-full h-full object-contain"
                        alt="Original"
                      />
                    ) : (
                      <motion.img
                        key="styled"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        src={image.styledUrl}
                        className="w-full h-full object-contain frosted-fade-in"
                        alt="Styled"
                      />
                    )}
                  </AnimatePresence>

                  {/* Status Overlay */}
                  {image.status === 'processing' && (
                    <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                      <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                      <div className="flex flex-col items-center text-center">
                        <span className="text-white font-bold text-lg">Enhancing Vision</span>
                        <span className="text-zinc-400 text-sm">Applying AI styles to your image...</span>
                      </div>
                    </div>
                  )}

                  {/* Badge */}
                  <div className="absolute top-4 left-4 px-3 py-1.5 bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-full flex items-center gap-2 shadow-lg">
                    {showOriginal || !image.styledUrl ? (
                      <>
                        <Layers className="w-3 h-3 text-zinc-400" />
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Original</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-indigo-400" />
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">AI Enhanced</span>
                      </>
                    )}
                  </div>
                </div>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </div>

      {/* Bottom Navigation */}
      <div className="h-20 border-t border-zinc-800 bg-zinc-900/50 backdrop-blur-xl px-6 flex items-center justify-center gap-4 relative z-20">
        <button className="p-3 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-500 hover:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div 
              key={i} 
              className={`w-2 h-2 rounded-full transition-all ${i === 0 ? 'bg-indigo-500 w-6' : 'bg-zinc-800'}`} 
            />
          ))}
        </div>
        <button className="p-3 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-500 hover:text-white">
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
