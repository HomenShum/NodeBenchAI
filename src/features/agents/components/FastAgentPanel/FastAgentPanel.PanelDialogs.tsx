import React, { memo } from 'react';
import { Download, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

export interface PanelDialogsProps {
  // Artifacts
  showArtifacts: boolean;
  setShowArtifacts: (value: boolean) => void;
  artifactContent: { type: string; content: string; language?: string } | null;

  // Drag and drop
  isDragOver: boolean;
  setIsDragOver: (value: boolean) => void;
  setAttachedFiles: React.Dispatch<React.SetStateAction<File[]>>;

  // Resize Handle
  variant: 'overlay' | 'sidebar';

}

export const PanelDialogs = memo(function PanelDialogs(props: PanelDialogsProps) {
  return (
    <>
      {/* Artifacts/Canvas Panel */}
      {props.showArtifacts && props.artifactContent && (
        <>
          <div className="absolute inset-0 z-40 bg-surface-secondary" onClick={() => props.setShowArtifacts(false)} />
          <div className="absolute inset-y-2 right-2 w-[45%] min-w-[300px] z-50 bg-surface border border-edge rounded-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-edge glass-header">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-content">
                  {props.artifactContent.type === 'html' ? '\u{1F310} HTML Preview' : props.artifactContent.type === 'svg' ? '\u{1F3A8} SVG Preview' : `\u{1F4C4} ${props.artifactContent.language || 'Code'}`}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-surface-secondary text-content-muted">
                  {props.artifactContent.content.length} chars
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(props.artifactContent!.content); toast.success('Copied'); }}
                  className="text-xs px-2 py-1 rounded-md hover:bg-surface-secondary text-content-muted"
                >
                  Copy
                </button>
                <button type="button" onClick={() => props.setShowArtifacts(false)} className="text-content-muted hover:text-content text-sm px-1">&times;</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {props.artifactContent.type === 'html' || props.artifactContent.type === 'svg' ? (
                <iframe
                  srcDoc={props.artifactContent.type === 'svg'
                    ? `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f9fafb">${props.artifactContent.content}</body></html>`
                    : props.artifactContent.content}
                  className="w-full h-full border-none bg-surface"
                  sandbox="allow-scripts"
                  title="Artifact Preview"
                />
              ) : (
                <pre className="text-xs font-mono p-4 overflow-auto text-content-secondary whitespace-pre-wrap leading-relaxed">
                  {props.artifactContent.content}
                </pre>
              )}
            </div>
          </div>
        </>
      )}

      {/* Drag-and-Drop File Upload Overlay */}
      {props.isDragOver && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center rounded-lg border-2 border-dashed border-[var(--accent-primary)] bg-[var(--accent-primary)]/8"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDragLeave={() => props.setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.setIsDragOver(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
              props.setAttachedFiles(prev => [...prev, ...files]);
              toast.success(`${files.length} file(s) attached`);
            }
          }}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <Download className="w-6 h-6 text-violet-600" />
            </div>
            <span className="text-sm font-medium text-violet-700 dark:text-violet-300">Drop files here</span>
            <span className="text-xs text-violet-500">Images, PDFs, documents</span>
          </div>
        </div>
      )}

      {/* Drag-to-resize handle (left edge) */}
      {props.variant !== 'sidebar' && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-600/30 transition-colors z-50 group"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const panel = (e.target as HTMLElement).closest('.fast-agent-panel') as HTMLElement;
            if (!panel) return;
            const startWidth = panel.offsetWidth;
            const onMove = (ev: MouseEvent) => {
              const delta = startX - ev.clientX;
              const newWidth = Math.max(400, Math.min(1200, startWidth + delta));
              panel.style.width = `${newWidth}px`;
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="w-3 h-3 text-content-muted" />
          </div>
        </div>
      )}
    </>
  );
});
