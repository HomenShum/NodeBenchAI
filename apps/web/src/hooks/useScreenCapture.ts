import { useState, useCallback } from 'react';

interface UseScreenCaptureReturn {
  isCapturing: boolean;
  screenshotData: string | null;
  error: string | null;
  captureScreen: () => Promise<string | null>;
  clearScreenshot: () => void;
}

/**
 * Hook for capturing screenshots using the Screen Capture API
 */
export function useScreenCapture(): UseScreenCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [screenshotData, setScreenshotData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const captureScreen = useCallback(async (): Promise<string | null> => {
    setIsCapturing(true);
    setError(null);

    try {
      // Request screen capture permission
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // @ts-expect-error - mediaSource is valid but not in types
          mediaSource: 'screen',
        },
      });

      // Create video element to capture frame
      const video = document.createElement('video');
      video.srcObject = stream;
      void video.play();

      // Wait for video to load
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
      });

      // Small delay to ensure frame is ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create canvas and draw video frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(video, 0, 0);

      // Stop all tracks
      stream.getTracks().forEach((track) => track.stop());

      // Convert to data URL
      const dataUrl = canvas.toDataURL('image/png');
      setScreenshotData(dataUrl);
      setIsCapturing(false);

      return dataUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Screen capture failed';
      setError(message);
      setIsCapturing(false);
      return null;
    }
  }, []);

  const clearScreenshot = useCallback(() => {
    setScreenshotData(null);
    setError(null);
  }, []);

  return {
    isCapturing,
    screenshotData,
    error,
    captureScreen,
    clearScreenshot,
  };
}

export default useScreenCapture;

