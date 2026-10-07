import { useState, useCallback, useEffect } from 'react';

export interface ZoomState {
  scale: number;
  minScale: number;
  maxScale: number;
}

export interface ZoomControls {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  resetZoom: () => void;
  setZoom: (scale: number) => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

export const useZoom = (
  initialScale: number = 1,
  minScale: number = 0.25,
  maxScale: number = 3,
  step: number = 0.25
): [ZoomState, ZoomControls] => {
  const [scale, setScale] = useState(initialScale);

  const zoomIn = useCallback(() => {
    setScale(prev => Math.min(prev + step, maxScale));
  }, [step, maxScale]);

  const zoomOut = useCallback(() => {
    setScale(prev => Math.max(prev - step, minScale));
  }, [step, minScale]);

  const zoomToFit = useCallback(() => {
    // Calculate zoom to fit based on container size
    // This will be implemented differently for different components
    setScale(1);
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
  }, []);

  const setZoom = useCallback((newScale: number) => {
    setScale(Math.max(minScale, Math.min(newScale, maxScale)));
  }, [minScale, maxScale]);

  const canZoomIn = scale < maxScale;
  const canZoomOut = scale > minScale;

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case '=':
          case '+':
            e.preventDefault();
            zoomIn();
            break;
          case '-':
            e.preventDefault();
            zoomOut();
            break;
          case '0':
            e.preventDefault();
            resetZoom();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomIn, zoomOut, resetZoom]);

  const zoomState: ZoomState = {
    scale,
    minScale,
    maxScale,
  };

  const zoomControls: ZoomControls = {
    zoomIn,
    zoomOut,
    zoomToFit,
    resetZoom,
    setZoom,
    canZoomIn,
    canZoomOut,
  };

  return [zoomState, zoomControls];
};
