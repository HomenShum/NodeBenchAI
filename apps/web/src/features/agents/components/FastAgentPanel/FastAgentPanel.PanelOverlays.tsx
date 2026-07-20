import { memo, type RefObject } from 'react';
import { X } from 'lucide-react';

export interface PanelOverlaysProps {
  showShortcutsOverlay: boolean;
  setShowShortcutsOverlay: (value: boolean) => void;
  showTimeline: boolean;
  setShowTimelineState: (value: boolean) => void;
  messagesToRender: any[] | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export const PanelOverlays = memo(function PanelOverlays(props: PanelOverlaysProps) {
  const shortcuts = [
    { keys: '/', desc: 'Focus message input' },
    { keys: '?', desc: 'Toggle this overlay' },
    { keys: 'Ctrl+F', desc: 'Search messages' },
    ...((props.messagesToRender?.length ?? 0) > 0
      ? [{ keys: 'Ctrl+T', desc: 'Conversation timeline' }]
      : []),
    { keys: 'Ctrl+Shift+N', desc: 'New conversation' },
    { keys: 'j', desc: 'Next message' },
    { keys: 'k', desc: 'Previous message' },
    { keys: 'Escape', desc: 'Close overlays / blur / close' },
    { keys: 'Enter', desc: 'Send message' },
    { keys: 'Shift+Enter', desc: 'New line in message' },
  ];

  return (
    <>
      {props.showShortcutsOverlay ? (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => props.setShowShortcutsOverlay(false)} />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-6 pointer-events-none">
            <div className="pointer-events-auto bg-surface border border-edge rounded-lg shadow-2xl w-full max-w-sm p-5 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-content">Keyboard Shortcuts</h3>
                <button type="button" onClick={() => props.setShowShortcutsOverlay(false)} className="action-btn p-1 text-content-muted hover:text-content rounded-md hover:bg-surface-secondary" aria-label="Close keyboard shortcuts">
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="space-y-2.5 text-xs">
                {shortcuts.map((shortcut) => (
                  <div key={shortcut.keys} className="flex items-center justify-between">
                    <span className="text-content-secondary">{shortcut.desc}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.split('+').map((key) => (
                        <kbd key={key} className="px-1.5 py-0.5 bg-surface-secondary border border-edge rounded text-xs font-mono text-content-muted">{key}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-content-muted text-center">Press <kbd className="px-1 py-0.5 bg-surface-secondary border border-edge rounded text-xs font-mono">?</kbd> or <kbd className="px-1 py-0.5 bg-surface-secondary border border-edge rounded text-xs font-mono">Esc</kbd> to close</p>
            </div>
          </div>
        </>
      ) : null}

      {props.showTimeline && props.messagesToRender && props.messagesToRender.length > 0 ? (
        <>
          <div className="absolute inset-0 z-40" onClick={() => props.setShowTimelineState(false)} />
          <div className="absolute inset-x-3 top-14 bottom-14 z-50 bg-surface border border-edge rounded-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-edge">
              <span className="text-xs font-semibold text-content">Conversation Timeline</span>
              <button type="button" onClick={() => props.setShowTimelineState(false)} className="text-content-muted hover:text-content text-sm" aria-label="Close conversation timeline">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="relative border-l-2 border-edge ml-3 space-y-0">
                {props.messagesToRender.map((message: any, index: number) => {
                  const isUser = message.role === 'user';
                  const preview = (message.text || message.content || '').slice(0, 80);
                  return (
                    <button
                      key={message._id ?? message.id ?? index}
                      type="button"
                      className="relative block w-full pl-6 py-1.5 text-left hover:bg-surface-secondary rounded-r-lg transition-colors"
                      onClick={() => {
                        const messageElements = props.scrollContainerRef.current?.querySelectorAll('.msg-entrance');
                        const target = messageElements?.[index] as HTMLElement | undefined;
                        if (target) {
                          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          target.style.outline = '2px solid var(--accent-primary, #3b82f6)';
                          target.style.outlineOffset = '4px';
                          target.style.borderRadius = '12px';
                          setTimeout(() => { target.style.outline = 'none'; }, 2000);
                        }
                        props.setShowTimelineState(false);
                      }}
                    >
                      <span className={`absolute left-[-5px] top-3 w-2.5 h-2.5 rounded-full border-2 border-surface ${isUser ? 'bg-indigo-600' : 'bg-green-500'}`} />
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-surface-secondary text-content-muted">{isUser ? 'You' : 'AI'}</span>
                      <span className="block text-xs text-content-secondary mt-0.5 truncate">{preview || '(empty)'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="px-4 py-2 border-t border-edge text-xs text-content-muted">
              {props.messagesToRender.length} messages
            </div>
          </div>
        </>
      ) : null}
    </>
  );
});
