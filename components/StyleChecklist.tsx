
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { StyleCategory, StyleSubItem, CustomClothingItem, ImageState, CustomAccessoryItem, CustomFaceItem, CustomBackgroundItem, CustomSkyItem } from '../types';
import { ChevronDownIcon, CloseIcon, SpinnerIcon, XCircleIcon, TextIcon, SparklesIcon, CheckIcon } from '@/components/icons';
import { ImageUploader } from './ImageUploader';

interface StyleChecklistProps {
  items: StyleCategory[];
  onCheckChange: (categoryId: string, subItemId: string, isChecked: boolean) => void;
  onIntensityChange: (categoryId: string, intensity: number) => void;
  disabled: boolean;
  openCategoryId: string | null;
  onCategoryToggle: (categoryId: string) => void;
  onCustomTextChange: (categoryId: string, value: string) => void;
  onCustomTextStyleChange: (categoryId: string, value: string) => void;
  onCustomPromptChange: (categoryId: string, value: string) => void;
  onToggleAllInCategory: (categoryId: string, checkAll: boolean) => void;
  onSubItemValueChange: (categoryId: string, subItemId: string, value: string) => void;
  
  customClothingItems: { man: CustomClothingItem[], woman: CustomClothingItem[] };
  onCustomClothingUpload: (gender: 'man' | 'woman', id: string, imageState: ImageState) => void;
  onCustomClothingToggle: (gender: 'man' | 'woman', id: string, checked: boolean) => void;
  onRemoveCustomClothing: (gender: 'man' | 'woman', id: string) => void;
  customAccessoryItems: { man: CustomAccessoryItem[], woman: CustomAccessoryItem[] };
  onCustomAccessoryUpload: (gender: 'man' | 'woman', id: string, imageState: ImageState) => void;
  onCustomAccessoryToggle: (gender: 'man' | 'woman', id: string, checked: boolean) => void;
  onRemoveCustomAccessory: (gender: 'man' | 'woman', id: string) => void;
  customFaceItems: { man: CustomFaceItem, woman: CustomFaceItem };
  onCustomFaceUpload: (gender: 'man' | 'woman', imageState: ImageState) => void;
  onCustomFaceToggle: (gender: 'man' | 'woman', checked: boolean) => void;
  onRemoveCustomFace: (gender: 'man' | 'woman') => void;
  customBackgroundItem: CustomBackgroundItem;
  onCustomBackgroundUpload: (imageState: ImageState) => void;
  onCustomBackgroundToggle: (checked: boolean) => void;
  onRemoveCustomBackground: () => void;
  customSkyItem: CustomSkyItem;
  onCustomSkyUpload: (imageState: ImageState) => void;
  onCustomSkyToggle: (checked: boolean) => void;
  onRemoveCustomSky: () => void;
}

const ConfidenceIndicator: React.FC<{ confidence: StyleSubItem['confidence'] }> = ({ confidence }) => {
    const levels = {
        high: 3,
        medium: 2,
        low: 1
    };
    const currentLevel = levels[confidence] || 1;
    
    return (
        <div className="flex items-center gap-0.5" title={`${confidence.charAt(0).toUpperCase() + confidence.slice(1)} Confidence`}>
            {[1, 2, 3].map((level) => (
                <div 
                    key={level}
                    className={`w-2 h-1 transition-all duration-300 ${
                        level <= currentLevel 
                            ? (confidence === 'high' ? 'bg-emerald-500' : 
                               confidence === 'medium' ? 'bg-amber-500' : 
                               'bg-rose-500')
                            : 'bg-white/5'
                    }`}
                />
            ))}
        </div>
    );
};

const CustomItemUploader: React.FC<{
    item: CustomClothingItem | CustomAccessoryItem;
    onUpload: (imageState: ImageState) => void;
    onToggle: (checked: boolean) => void;
    onRemove: () => void;
    disabled: boolean;
}> = ({ item, onUpload, onToggle, onRemove, disabled }) => (
    <div 
        className={`group relative rounded-xl border p-3 transition-all duration-300 ${
            item.enabled 
                ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/5' 
                : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-hover)]'
        }`}
    >
        <div className="flex items-center justify-between mb-3 px-1 relative z-10">
            <label className="flex items-center gap-2 cursor-pointer group/label">
                <div className="relative flex items-center">
                    <input
                        id={`toggle-${item.id}`}
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(e) => onToggle(e.target.checked)}
                        disabled={disabled || item.status !== 'ready'}
                        className="peer sr-only"
                    />
                    <div className={`w-3.5 h-3.5 rounded-sm border transition-all duration-300 flex items-center justify-center ${
                        item.enabled 
                            ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' 
                            : 'bg-black/40 border-[#333333]'
                    }`}>
                        {item.enabled && <CheckIcon className="w-2 h-2 text-black font-black" />}
                    </div>
                </div>
                <span className={`text-xs font-semibold transition-colors duration-300 ${item.enabled ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] group-hover/label:text-white'}`}>
                    Slot {Number(item.id.split('-').pop()) + 1 || item.id.split('-').pop()}
                </span>
            </label>
            {item.status !== 'empty' && (
                <button 
                    onClick={onRemove}
                    className="p-1 text-[var(--color-text-muted)] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove Item"
                >
                    <CloseIcon className="w-3 h-3" />
                </button>
            )}
        </div>
        
        <div className="relative z-10 aspect-square">
            <ImageUploader 
                id={`upload-${item.id}`}
                title=""
                subtitle={item.id.replace(/_/g, ' ')}
                image={item.image}
                onImageSelect={onUpload}
                compact
                disabled={disabled}
            />
        {item.status === 'analyzing' && (
            <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-20">
                <SpinnerIcon className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                <span className="mt-2 text-xs font-semibold text-[var(--color-text-muted)]">Analyzing</span>
            </div>
        )}
        
        {item.status === 'error' && (
            <div className="absolute inset-0 bg-red-900/20 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                <XCircleIcon className="w-5 h-5 text-red-500" />
                <span className="mt-2 text-xs font-semibold text-red-400">Analysis failed</span>
                <button onClick={onRemove} className="mt-1 text-[8px] font-bold underline text-red-500/80 hover:text-red-500">Clear</button>
            </div>
        )}
        </div>
    </div>
);

const GenderUploadSection: React.FC<{
    gender: 'man' | 'woman';
    items: (CustomClothingItem | CustomAccessoryItem)[];
    onUpload: (id: string, imageState: ImageState) => void;
    onToggle: (id: string, checked: boolean) => void;
    onRemove: (id: string) => void;
    disabled: boolean;
}> = ({ gender, items, onUpload, onToggle, onRemove, disabled }) => (
    <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
            <h5 className="text-xs font-semibold text-[var(--color-text-muted)]">{gender} references</h5>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {items.map(item => (
                <CustomItemUploader
                    key={item.id}
                    item={item}
                    onUpload={(imageState) => onUpload(item.id, imageState)}
                    onToggle={(checked) => onToggle(item.id, checked)}
                    onRemove={() => onRemove(item.id)}
                    disabled={disabled}
                />
            ))}
        </div>
    </div>
);

const CustomClothingPanel: React.FC<{
    items: { man: CustomClothingItem[], woman: CustomClothingItem[] };
    onUpload: (gender: 'man' | 'woman', id: string, imageState: ImageState) => void;
    onToggle: (gender: 'man' | 'woman', id: string, checked: boolean) => void;
    onRemove: (gender: 'man' | 'woman', id: string) => void;
    disabled: boolean;
}> = ({ items, onUpload, onToggle, onRemove, disabled }) => {
    return (
        <div className="space-y-4 pt-2">
            <GenderUploadSection
                gender="woman"
                items={items.woman}
                onUpload={(id, img) => onUpload('woman', id, img)}
                onToggle={(id, chk) => onToggle('woman', id, chk)}
                onRemove={(id) => onRemove('woman', id)}
                disabled={disabled}
            />
            <GenderUploadSection
                gender="man"
                items={items.man}
                onUpload={(id, img) => onUpload('man', id, img)}
                onToggle={(id, chk) => onToggle('man', id, chk)}
                onRemove={(id) => onRemove('man', id)}
                disabled={disabled}
            />
        </div>
    );
};

const CustomAccessoryPanel: React.FC<{
    items: { man: CustomAccessoryItem[], woman: CustomAccessoryItem[] };
    onUpload: (gender: 'man' | 'woman', id: string, imageState: ImageState) => void;
    onToggle: (gender: 'man' | 'woman', id: string, checked: boolean) => void;
    onRemove: (gender: 'man' | 'woman', id: string) => void;
    disabled: boolean;
}> = ({ items, onUpload, onToggle, onRemove, disabled }) => {
    return (
        <div className="space-y-4 pt-2">
            <GenderUploadSection
                gender="woman"
                items={items.woman}
                onUpload={(id, img) => onUpload('woman', id, img)}
                onToggle={(id, chk) => onToggle('woman', id, chk)}
                onRemove={(id) => onRemove('woman', id)}
                disabled={disabled}
            />
            <GenderUploadSection
                gender="man"
                items={items.man}
                onUpload={(id, img) => onUpload('man', id, img)}
                onToggle={(id, chk) => onToggle('man', id, chk)}
                onRemove={(id) => onRemove('man', id)}
                disabled={disabled}
            />
        </div>
    );
};

const CustomFacePanel: React.FC<{
    items: { man: CustomFaceItem, woman: CustomFaceItem };
    onUpload: (gender: 'man' | 'woman', imageState: ImageState) => void;
    onToggle: (gender: 'man' | 'woman', checked: boolean) => void;
    onRemove: (gender: 'man' | 'woman') => void;
    disabled: boolean;
}> = ({ items, onUpload, onToggle, onRemove, disabled }) => {
    const FaceUploader: React.FC<{ gender: 'man' | 'woman' }> = ({ gender }) => {
        const item = items[gender];
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                    <h5 className="text-xs font-semibold text-[var(--color-text-muted)]">{gender} face reference</h5>
                </div>
                <CustomItemUploader
                    item={{...item, id: `face-${gender}`}}
                    onUpload={(imageState) => onUpload(gender, imageState)}
                    onToggle={(checked) => onToggle(gender, checked)}
                    onRemove={() => onRemove(gender)}
                    disabled={disabled}
                />
            </div>
        );
    };

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
            <FaceUploader gender="woman" />
            <FaceUploader gender="man" />
        </div>
    );
};

const CustomBackgroundPanel: React.FC<{
    item: CustomBackgroundItem;
    onUpload: (imageState: ImageState) => void;
    onToggle: (checked: boolean) => void;
    onRemove: () => void;
    disabled: boolean;
}> = ({ item, onUpload, onToggle, onRemove, disabled }) => {
    return (
        <div className="space-y-3 pt-2">
            <div className={`relative overflow-hidden rounded-xl border p-4 transition-all duration-300 ${
                item.enabled 
                    ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/5' 
                    : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-hover)]'
            }`}>
                <label className="flex items-center gap-3 cursor-pointer mb-5 group/toggle">
                    <div className="relative flex items-center">
                        <input
                            type="checkbox"
                            checked={item.enabled}
                            onChange={(e) => onToggle(e.target.checked)}
                            disabled={disabled || item.status !== 'ready'}
                            className="peer sr-only"
                        />
                        <div className={`w-8 h-4 rounded-full transition-all duration-300 border border-[#333333] ${item.enabled ? 'bg-[var(--color-accent)]' : 'bg-black'}`}>
                            <motion.div 
                                animate={{ x: item.enabled ? 18 : 2 }}
                                className={`absolute top-1 w-2 h-2 rounded-full shadow-sm ${item.enabled ? 'bg-black' : 'bg-[#555555]'}`}
                            />
                        </div>
                    </div>
                    <span className={`text-xs font-semibold transition-colors ${item.enabled ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>
                        Use background reference
                    </span>
                </label>
                
                <div className="relative group/uploader aspect-[16/10]">
                    <ImageUploader 
                        id="upload-custom-background"
                        title="Environment"
                        subtitle="Upload scene"
                        image={item.image}
                        onImageSelect={onUpload}
                        compact={false}
                        disabled={disabled}
                    />
                    <AnimatePresence>
                        {item.status !== 'empty' && item.status !== 'ready' && (
                            <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center text-center p-4 border border-[#222222]"
                            >
                                {item.status === 'analyzing' && (
                                    <div className="w-10 h-10 border-2 border-[var(--color-accent)]/20 border-t-[var(--color-accent)] rounded-full animate-spin" />
                                )}
                                {item.status === 'error' && <XCircleIcon className="w-10 h-10 text-red-500" />}
                                <span className="text-[10px] mt-4 font-black text-white uppercase tracking-[0.3em]">{item.status}</span>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    {item.image.base64 && (
                         <button 
                            onClick={onRemove} 
                            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--color-border)] bg-black/80 text-white transition-all hover:bg-red-500"
                        >
                            <CloseIcon className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const CustomSkyPanel: React.FC<{
    item: CustomSkyItem;
    onUpload: (imageState: ImageState) => void;
    onToggle: (checked: boolean) => void;
    onRemove: () => void;
    disabled: boolean;
}> = ({ item, onUpload, onToggle, onRemove, disabled }) => {
    return (
        <div className="space-y-3 pt-2">
            <div className={`relative overflow-hidden rounded-xl border p-4 transition-all duration-300 ${
                item.enabled 
                    ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/5' 
                    : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-hover)]'
            }`}>
                <label className="flex items-center gap-3 cursor-pointer mb-5 group/toggle">
                    <div className="relative flex items-center">
                        <input
                            type="checkbox"
                            checked={item.enabled}
                            onChange={(e) => onToggle(e.target.checked)}
                            disabled={disabled || item.status !== 'ready'}
                            className="peer sr-only"
                        />
                        <div className={`w-8 h-4 rounded-full transition-all duration-300 border border-[#333333] ${item.enabled ? 'bg-[var(--color-accent)]' : 'bg-black'}`}>
                            <motion.div 
                                animate={{ x: item.enabled ? 18 : 2 }}
                                className={`absolute top-1 w-2 h-2 rounded-full shadow-sm ${item.enabled ? 'bg-black' : 'bg-[#555555]'}`}
                            />
                        </div>
                    </div>
                    <span className={`text-xs font-semibold transition-colors ${item.enabled ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>
                        Use sky reference
                    </span>
                </label>
                
                <div className="relative group/uploader aspect-[16/10]">
                    <ImageUploader 
                        id="upload-custom-sky"
                        title="Sky reference"
                        subtitle="Upload sky"
                        image={item.image}
                        onImageSelect={onUpload}
                        compact={false}
                        disabled={disabled}
                    />
                    <AnimatePresence>
                        {item.status !== 'empty' && item.status !== 'ready' && (
                            <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center text-center p-4 border border-[#222222]"
                            >
                                {item.status === 'analyzing' && (
                                    <div className="w-10 h-10 border-2 border-[var(--color-accent)]/20 border-t-[var(--color-accent)] rounded-full animate-spin" />
                                )}
                                {item.status === 'error' && <XCircleIcon className="w-10 h-10 text-red-500" />}
                                <span className="text-[10px] mt-4 font-black text-white uppercase tracking-[0.3em]">{item.status}</span>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    {item.image.base64 && (
                         <button 
                            onClick={onRemove} 
                            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--color-border)] bg-black/80 text-white transition-all hover:bg-red-500"
                        >
                            <CloseIcon className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};


export const StyleChecklist: React.FC<StyleChecklistProps> = (props) => {
  const { items, onCheckChange, onIntensityChange, disabled, openCategoryId, onCategoryToggle, onCustomTextChange, onCustomTextStyleChange, onCustomPromptChange, onToggleAllInCategory, onSubItemValueChange, customClothingItems, onCustomClothingUpload, onCustomClothingToggle, onRemoveCustomClothing, customAccessoryItems, onCustomAccessoryUpload, onCustomAccessoryToggle, onRemoveCustomAccessory, customFaceItems, onCustomFaceUpload, onCustomFaceToggle, onRemoveCustomFace, customBackgroundItem, onCustomBackgroundUpload, onCustomBackgroundToggle, onRemoveCustomBackground, customSkyItem, onCustomSkyUpload, onCustomSkyToggle, onRemoveCustomSky } = props;
  
  if (items.length === 0) {
    return null;
  }
  
  const StyleItem: React.FC<{ category: StyleCategory; item: StyleSubItem }> = ({ category, item }) => (
    <div 
        className={`group relative overflow-hidden rounded-xl border transition-all duration-300 ${
            item.checked 
                ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 shadow-xl' 
                : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-hover)]'
        }`}
    >
        {item.checked && (
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-accent)]" />
        )}
        
        <label htmlFor={`${category.id}-${item.id}`} className="flex items-start gap-4 p-4 cursor-pointer w-full select-none relative z-10">
            <div className="relative flex items-center mt-1">
                <input
                    id={`${category.id}-${item.id}`}
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => !disabled && onCheckChange(category.id, item.id, e.target.checked)}
                    disabled={disabled}
                    className="peer sr-only"
                />
                <div className={`w-4 h-4 border transition-all duration-300 flex items-center justify-center rounded-sm ${
                    item.checked 
                        ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' 
                        : 'bg-black/40 border-[#333333] peer-hover:border-[#444444]'
                }`}>
                    {item.checked && (
                        <CheckIcon className="w-3 h-3 text-black font-black" />
                    )}
                </div>
            </div>
            
            <div className="flex-grow min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold transition-colors duration-300 ${
                        item.checked ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] group-hover:text-white/80'
                    }`}>
                        {item.label}
                    </span>
                    <ConfidenceIndicator confidence={item.confidence} />
                </div>
                <p className={`mt-1 text-xs font-medium leading-relaxed transition-colors duration-300 opacity-60 group-hover:opacity-90 ${
                    item.checked ? 'text-white' : 'text-[var(--color-text-muted)]'
                }`}>
                    {item.description}
                </p>
            </div>
        </label>
        
        <AnimatePresence>
            {category.id === 'text_styles' && item.checked && (
                <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="px-4 pb-4"
                >
                    <div className="relative group/input">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--color-text-muted)]">
                            <TextIcon className="w-3.5 h-3.5" />
                        </div>
                        <input 
                            type="text" 
                            value={item.customValue || ''} 
                            onChange={(e) => onSubItemValueChange(category.id, item.id, e.target.value)} 
                            disabled={disabled} 
                            placeholder={item.id === 'add_custom_text' ? "Enter text..." : "Override text content..."}
                            className="w-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-2.5 pl-9 pr-3 text-xs font-semibold text-white outline-none transition-all placeholder-white/30 focus:border-[var(--color-accent)]" 
                        />
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    </div>
  );

  return (
    <div className="space-y-3">
      {items.map((category) => {
        const checkedCount = category.items.filter(item => item.checked).length;
        const isCategoryActive = checkedCount > 0 || (category.id === 'background_elements' && (category.customPrompt || customBackgroundItem.enabled || customSkyItem.enabled));
        const isOpen = openCategoryId === category.id;

        return (
          <div key={category.id} className={`group/card overflow-hidden rounded-xl border transition-all duration-300 ${
            isOpen 
                ? 'border-[var(--color-border-hover)] bg-[var(--color-surface)] shadow-2xl' 
                : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-hover)]'
          }`}>
            <button 
                className="w-full flex items-center justify-between p-4 cursor-pointer group transition-colors hover:bg-white/[0.02]"
                onClick={() => onCategoryToggle(category.id)}
            >
                <div className="flex items-center gap-4 overflow-hidden">
                    <div className="relative">
                        <span className={`text-xs font-semibold transition-colors duration-300 ${
                            isOpen ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] group-hover:text-white'
                        }`}>
                            {category.label}
                        </span>
                    </div>
                    {checkedCount > 0 && (
                        <div className="flex items-center justify-center min-w-[16px] h-[16px] px-1 bg-[var(--color-accent)] rounded-xs">
                            <span className="text-[black] text-[9px] font-black leading-none">{checkedCount}</span>
                        </div>
                    )}
                </div>
                <div className={`w-6 h-6 flex items-center justify-center transition-all duration-300 rounded ${
                    isOpen ? 'bg-[var(--color-accent)] rotate-180' : 'bg-white/5'
                }`}>
                    <ChevronDownIcon className={`w-3.5 h-3.5 ${isOpen ? 'text-black' : 'text-[var(--color-text-muted)]'}`} />
                </div>
            </button>

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "circOut" }}
                    >
                        <div className="px-4 pb-6 space-y-6 border-t border-[#222222] pt-5">
                           {/* Strength Slider */}
                           <div className={`space-y-4 transition-all duration-500 ${isCategoryActive ? 'opacity-100' : 'opacity-20 grayscale'}`}>
                              <div className="flex justify-between items-end px-1">
                                  <label className="text-xs font-semibold text-[var(--color-text-muted)]">Strength</label>
                                  <span className="text-sm font-semibold leading-none text-white">{category.intensity}%</span>
                              </div>
                              <div className="relative group/slider px-1">
                                  <input
                                      type="range" min="0" max="100" step="1"
                                      value={category.intensity}
                                      onChange={(e) => onIntensityChange(category.id, parseInt(e.target.value, 10))}
                                      disabled={disabled || !isCategoryActive}
                                      className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer themed-slider accent-[var(--color-accent)]"
                                  />
                              </div>
                           </div>

                           <div className="grid grid-cols-1 gap-1">
                             {category.items.map((item) => (
                                <StyleItem key={item.id} category={category} item={item} />
                             ))}
                           </div>
                           
                           {category.id === 'background_elements' && (
                            <div className="space-y-6 pt-6 border-t border-[#222222]">
                                <div className="space-y-2">
                                     <label className="text-xs font-semibold text-[var(--color-text-muted)]">Scene notes</label>
                                     <textarea
                                        value={category.customPrompt || ''}
                                        onChange={(e) => onCustomPromptChange(category.id, e.target.value)}
                                        placeholder="Describe any background, lighting, or environment direction..."
                                        className="min-h-[100px] w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 text-xs font-semibold text-white outline-none transition-all placeholder-white/30 focus:border-[var(--color-accent)]"
                                        disabled={disabled}
                                    />
                                </div>
                                
                                <div className="space-y-1">
                                    <CustomSkyPanel
                                        item={customSkyItem}
                                        onUpload={onCustomSkyUpload}
                                        onToggle={onCustomSkyToggle}
                                        onRemove={onRemoveCustomSky}
                                        disabled={disabled}
                                    />
                                    <CustomBackgroundPanel
                                        item={customBackgroundItem}
                                        onUpload={onCustomBackgroundUpload}
                                        onToggle={onCustomBackgroundToggle}
                                        onRemove={onRemoveCustomBackground}
                                        disabled={disabled}
                                    />
                                </div>
                            </div>
                           )}
                           
                           {category.id === 'clothing_style' && (
                            <div className="pt-4 border-t border-[var(--color-border)]">
                              <CustomClothingPanel
                                items={customClothingItems}
                                onUpload={onCustomClothingUpload}
                                onToggle={onCustomClothingToggle}
                                onRemove={onRemoveCustomClothing}
                                disabled={disabled}
                               />
                            </div>
                           )}

                           {category.id === 'accessories' && (
                            <div className="pt-4 border-t border-[var(--color-border)]">
                              <CustomAccessoryPanel
                                items={customAccessoryItems}
                                onUpload={onCustomAccessoryUpload}
                                onToggle={onCustomAccessoryToggle}
                                onRemove={onRemoveCustomAccessory}
                                disabled={disabled}
                               />
                            </div>
                           )}

                           {category.id === 'subject_style' && (
                            <div className="pt-4 border-t border-[var(--color-border)]">
                                <CustomFacePanel
                                    items={customFaceItems}
                                    onUpload={onCustomFaceUpload}
                                    onToggle={onCustomFaceToggle}
                                    onRemove={onRemoveCustomFace}
                                    disabled={disabled}
                                />
                            </div>
                           )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};
