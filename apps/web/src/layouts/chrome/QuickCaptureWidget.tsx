import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation} from 'convex/react';
import { useMotionConfig } from '@/lib/motion';
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from '@/features/product/lib/productIdentity';
import { toast } from 'sonner';
import {
  Plus,
  X,
  FileText,
  Mic,
  Camera,
  CheckSquare,
  Send,
} from 'lucide-react';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import { useScreenCapture } from '@/hooks/useScreenCapture';

type CaptureMode = 'note' | 'task' | 'voice' | 'screenshot';

interface QuickCaptureWidgetProps {
  className?: string;
}

export function QuickCaptureWidget({ className = '' }: QuickCaptureWidgetProps) {
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();

  const { instant, transition } = useMotionConfig();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<CaptureMode>('note');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const saveContextCapture = useMutation(
    api?.domains.product.me.saveContextCapture ?? ("skip" as any),
  );
  const generateUploadUrl = useMutation(
    api?.domains.product.me.generateUploadUrl ?? ("skip" as any),
  );
  const saveFile = useMutation(api?.domains.product.me.saveFile ?? ("skip" as any));

  const { isRecording, audioBlob, duration, startRecording, stopRecording, clearRecording } =
    useVoiceRecording();
  const { screenshotData, captureScreen, clearScreenshot } = useScreenCapture();

  const hasSaveableContent =
    mode === 'voice'
      ? Boolean(audioBlob)
      : mode === 'screenshot'
        ? Boolean(screenshotData)
        : Boolean(content.trim());

  const saveUploadedFile = useCallback(async (args: {
    blob: Blob;
    name: string;
    mimeType: string;
    category: 'voice' | 'image';
  }) => {
    const uploadUrl = await generateUploadUrl();
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': args.mimeType || 'application/octet-stream' },
      body: args.blob,
    });
    const { storageId } = await response.json();
    await saveFile({
      anonymousSessionId,
      storageId,
      name: args.name,
      mimeType: args.mimeType || 'application/octet-stream',
      size: args.blob.size,
      category: args.category,
    });
  }, [anonymousSessionId, generateUploadUrl, saveFile]);

  const handleModeSelect = useCallback((nextMode: CaptureMode) => {
    if (mode === 'voice' && nextMode !== 'voice' && isRecording) {
      stopRecording();
    }
    setMode(nextMode);
    if (nextMode !== 'voice') {
      clearRecording();
    }
    if (nextMode !== 'screenshot') {
      clearScreenshot();
    }
  }, [clearRecording, clearScreenshot, isRecording, mode, stopRecording]);

  const handleSave = useCallback(async () => {
    if (!hasSaveableContent) {
      toast.error(
        mode === 'voice'
          ? 'Record a voice memo first'
          : mode === 'screenshot'
            ? 'Capture a screenshot first'
            : 'Please add some content',
      );
      return;
    }

    setIsSaving(true);
    try {
      if (mode === 'note' || mode === 'task') {
        await saveContextCapture({
          anonymousSessionId,
          type: mode,
          content: content.trim(),
        });
      } else if (mode === 'voice' && audioBlob) {
        const extension = audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
        await saveUploadedFile({
          blob: audioBlob,
          name: `voice-memo-${Date.now()}.${extension}`,
          mimeType: audioBlob.type || 'audio/webm',
          category: 'voice',
        });
      } else if (mode === 'screenshot' && screenshotData) {
        const blob = await fetch(screenshotData).then((r) => r.blob());
        await saveUploadedFile({
          blob,
          name: `screenshot-${Date.now()}.png`,
          mimeType: 'image/png',
          category: 'image',
        });
      }

      toast.success('Captured!');
      setContent('');
      clearRecording();
      clearScreenshot();
      setIsOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [anonymousSessionId, audioBlob, clearRecording, clearScreenshot, content, hasSaveableContent, mode, saveContextCapture, saveUploadedFile, screenshotData]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const modeButtons: { mode: CaptureMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'note', icon: <FileText className="h-4 w-4" />, label: 'Note' },
    { mode: 'task', icon: <CheckSquare className="h-4 w-4" />, label: 'Task' },
    { mode: 'voice', icon: <Mic className="h-4 w-4" />, label: 'Voice' },
    { mode: 'screenshot', icon: <Camera className="h-4 w-4" />, label: 'Screenshot' },
  ];

  return (
    <div className={`fixed z-50 nb-fab-safe ${className}`}>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: instant ? 1 : 0.9, y: instant ? 0 : 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: instant ? 1 : 0.9, y: instant ? 0 : 20 }}
            transition={transition({ type: 'spring', stiffness: 300, damping: 25 })}
            className="absolute bottom-14 sm:bottom-16 right-0 w-80 bg-surface rounded-xl shadow-xl border border-edge overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
              <span className="text-sm font-semibold text-content">Quick Capture</span>
              <button onClick={() => setIsOpen(false)} aria-label="Close quick capture" className="p-1 hover:bg-surface-hover rounded transition-colors active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <X className="h-4 w-4 text-content-secondary" />
              </button>
            </div>

            {/* Mode Selector */}
            <div className="flex gap-1 p-2 border-b border-edge">
              {modeButtons.map(({ mode: m, icon, label }) => (
                <button
                  key={m}
                  onClick={() => handleModeSelect(m)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    mode === m
                      ? 'bg-primary/10 text-primary'
                      : 'text-content-secondary hover:bg-surface-hover hover:text-content'
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            {/* Content Area */}
            <div className="p-3">
              {(mode === 'note' || mode === 'task') && (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={mode === 'task' ? 'What needs to be done?' : 'Capture a thought...'}
                  className="w-full h-24 px-3 py-2 text-sm border border-edge bg-surface rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                  autoFocus
                />
              )}

              {mode === 'voice' && (
                <div className="flex flex-col items-center gap-3 py-4">
                  {isRecording ? (
                    <>
                      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center motion-safe:animate-pulse">
                        <Mic className="h-8 w-8 text-red-600" />
                      </div>
                      <span className="text-lg font-mono">{formatDuration(duration)}</span>
                      <button
                        onClick={stopRecording}
                        className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        Stop Recording
                      </button>
                    </>
                  ) : audioBlob ? (
                    <>
                      <audio src={URL.createObjectURL(audioBlob)} controls className="w-full" />
                      <button onClick={clearRecording} className="text-xs text-content-secondary hover:text-content-secondary">
                        Record again
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={startRecording}
                      aria-label="Start voice recording"
                      className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/15 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <Mic className="h-8 w-8 text-primary" />
                    </button>
                  )}
                </div>
              )}

              {mode === 'screenshot' && (
                <div className="flex flex-col items-center gap-3 py-4">
                  {screenshotData ? (
                    <>
                      <img src={screenshotData} alt="Screenshot" className="w-full rounded-lg border" />
                      <button onClick={clearScreenshot} className="text-xs text-content-secondary hover:text-content-secondary">
                        Capture again
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={captureScreen}
                      aria-label="Capture screenshot"
                      className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/15 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <Camera className="h-8 w-8 text-primary" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end px-3 pb-3 mt-2">
              <button
                onClick={handleSave}
                disabled={isSaving || !hasSaveableContent}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 shadow-sm"
              >
                <Send className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB Button */}
      <motion.button
        whileHover={!instant ? { scale: 1.05 } : undefined}
        whileTap={!instant ? { scale: 0.95 } : undefined}
        transition={transition({ type: 'spring', stiffness: 400, damping: 17 })}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Close quick capture' : 'Open quick capture'}
        title={isOpen ? 'Close quick capture' : 'Quick capture - add note, task, or voice memo'}
        className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full shadow-lg border border-edge/60 flex items-center justify-center transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
          isOpen ? 'bg-surface-secondary text-content' : 'bg-primary text-primary-foreground hover:opacity-90 shadow-primary/20'
        }`}
      >
        <motion.div animate={{ rotate: isOpen ? 45 : 0 }} transition={transition({ duration: 0.2 })} className="flex items-center justify-center">
          <Plus className="h-6 w-6" />
        </motion.div>
      </motion.button>
    </div>
  );
}

export default QuickCaptureWidget;
