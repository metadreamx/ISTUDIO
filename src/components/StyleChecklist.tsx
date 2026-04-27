import React from 'react';
import { Check, Info } from 'lucide-react';
import { StyleCategory } from '../types';

interface StyleChecklistProps {
  categories: StyleCategory[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

export const StyleChecklist: React.FC<StyleChecklistProps> = ({ 
  categories, 
  selectedIds, 
  onToggle 
}) => {
  return (
    <div className="space-y-6">
      {categories.map(category => (
        <div key={category.id} className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              {category.name}
            </h3>
            <button className="p-1 hover:bg-zinc-800 rounded transition-colors">
              <Info className="w-3 h-3 text-zinc-600" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {category.items.map(item => {
              const isSelected = selectedIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => onToggle(item.id)}
                  className={`group relative flex items-center justify-between p-3 rounded-xl border transition-all duration-300 ${
                    isSelected 
                      ? 'bg-indigo-600/10 border-indigo-500 shadow-lg shadow-indigo-500/5' 
                      : 'bg-zinc-800/30 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex flex-col items-start text-left">
                    <span className={`text-sm font-bold transition-colors ${
                      isSelected ? 'text-indigo-400' : 'text-zinc-300 group-hover:text-white'
                    }`}>
                      {item.name}
                    </span>
                    <span className="text-[10px] text-zinc-500 leading-tight mt-0.5">
                      {item.description}
                    </span>
                  </div>
                  
                  <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-300 ${
                    isSelected 
                      ? 'bg-indigo-600 border-indigo-500 scale-110' 
                      : 'border-zinc-700 bg-zinc-900/50 group-hover:border-zinc-600'
                  }`}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </div>

                  {/* Hover Glow Effect */}
                  <div className={`absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none ${
                    isSelected ? 'bg-indigo-500/5' : 'bg-white/5'
                  }`} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
