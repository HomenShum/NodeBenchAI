import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import { ZoomState, ZoomControls as ZoomControlsType } from '../hooks/useZoom';

interface ZoomControlsProps {
  zoomState: ZoomState;
  zoomControls: ZoomControlsType;
  position?: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
  className?: string;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({
  zoomState,
  zoomControls,
  position = 'bottom-right',
  className = '',
}) => {
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'bottom-right': 'bottom-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-left': 'bottom-4 left-4',
  };

  const zoomPercentage = Math.round(zoomState.scale * 100);

  return (
    <div className={`absolute ${positionClasses[position]} z-10 flex flex-col gap-1 bg-surface border border-edge rounded-lg shadow-lg p-2 ${className}`}>
      <div className="flex items-center gap-1">
        <button
          onClick={zoomControls.zoomOut}
          disabled={!zoomControls.canZoomOut}
          className="p-2 hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
          title="Zoom Out (Ctrl + -)"
        >
          <ZoomOut className="h-4 w-4 text-content-secondary" />
        </button>
        
        <div className="min-w-[60px] text-center">
          <span className="text-xs text-content-muted font-mono">
            {zoomPercentage}%
          </span>
        </div>
        
        <button
          onClick={zoomControls.zoomIn}
          disabled={!zoomControls.canZoomIn}
          className="p-2 hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
          title="Zoom In (Ctrl + +)"
        >
          <ZoomIn className="h-4 w-4 text-content-secondary" />
        </button>
      </div>
      
      <div className="flex items-center gap-1 border-t border-edge pt-1">
        <button
          onClick={zoomControls.zoomToFit}
          className="p-2 hover:bg-surface-hover rounded transition-colors"
          title="Zoom to Fit"
        >
          <Maximize2 className="h-4 w-4 text-content-secondary" />
        </button>
        
        <button
          onClick={zoomControls.resetZoom}
          className="p-2 hover:bg-surface-hover rounded transition-colors"
          title="Reset Zoom (Ctrl + 0)"
        >
          <RotateCcw className="h-4 w-4 text-content-secondary" />
        </button>
      </div>
    </div>
  );
};
