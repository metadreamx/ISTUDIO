
import React from 'react';
import { 
  Loader2, 
  Sparkles, 
  XCircle, 
  Check, 
  Upload, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Square, 
  Columns, 
  CheckCircle, 
  SlidersHorizontal, 
  X, 
  History, 
  Plus, 
  ChevronDown, 
  Type, 
  Palette, 
  ChevronRight,
  Lock
} from 'lucide-react';

export const Logo: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>
);

export const SpinnerIcon = Loader2;
export const SparklesIcon = Sparkles;
export const XCircleIcon = XCircle;
export const CheckIcon = Check;
export const UploadIcon = Upload;
export const DownloadIcon = Download;
export const ZoomInIcon = ZoomIn;
export const ZoomOutIcon = ZoomOut;
export const ResetIcon = RotateCcw;
export const SingleViewIcon = Square;
export const SideBySideViewIcon = Columns;
export const CheckCircleIcon = CheckCircle;
export const AdjustmentsHorizontalIcon = SlidersHorizontal;
export const CloseIcon = X;
export const HistoryIcon = History;
export const PlusIcon = Plus;
export const ChevronDownIcon = ChevronDown;
export const TextIcon = Type;
export const PaletteIcon = Palette;
export const ChevronRightIcon = ChevronRight;
export const LockIcon = Lock;
