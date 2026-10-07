import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for managing Command Palette state with global keyboard shortcut
 * Listens for Cmd/Ctrl+K to toggle the palette
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    };

    // Use capture phase to ensure we get the event before other handlers
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [toggle]);

  return {
    isOpen,
    open,
    close,
    toggle,
    setIsOpen,
  };
}

export type CommandPaletteState = ReturnType<typeof useCommandPalette>;

