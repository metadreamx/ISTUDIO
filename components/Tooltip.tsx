import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top' }) => {
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: position === 'top' ? 5 : -5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: position === 'top' ? 5 : -5 }}
            className={`absolute z-[110] px-3 py-1.5 bg-black/80 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-widest rounded-lg whitespace-nowrap pointer-events-none shadow-xl border border-white/10 ${positionClasses[position]}`}
          >
            {content}
            <div className={`absolute w-2 h-2 bg-black/80 rotate-45 border-white/10 ${
              position === 'top' ? 'top-full -translate-y-1/2 left-1/2 -translate-x-1/2 border-r border-b' :
              position === 'bottom' ? 'bottom-full translate-y-1/2 left-1/2 -translate-x-1/2 border-l border-t' :
              position === 'left' ? 'left-full -translate-x-1/2 top-1/2 -translate-y-1/2 border-r border-t' :
              'right-full translate-x-1/2 top-1/2 -translate-y-1/2 border-l border-b'
            }`} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
