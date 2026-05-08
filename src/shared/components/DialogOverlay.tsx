import { useEffect, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { cn } from "@/lib/utils";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  autoFocus?: boolean;
  positionClassName?: string;
  backdropClassName?: string;
  contentClassName?: string;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 28 },
  },
  exit: { opacity: 0, scale: 0.96, y: 4, transition: { duration: 0.15 } },
};

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [locked]);
}

/**
 * DialogOverlay — shared modal primitive with spring animation.
 *
 * Root cause: many views rolled their own fixed overlays without focus traps,
 * Escape handling, or scroll locking. That causes a11y regressions and visual
 * inconsistency (including harsh fade animations that read as "flashes").
 */
export function DialogOverlay({
  isOpen,
  onClose,
  children,
  ariaLabel,
  closeOnBackdrop = true,
  closeOnEscape = true,
  autoFocus = true,
  positionClassName,
  backdropClassName,
  contentClassName,
}: Props) {
  useBodyScrollLock(isOpen);

  const { containerProps } = useFocusTrap<HTMLDivElement>({
    enabled: isOpen,
    autoFocus,
    onEscape: closeOnEscape ? onClose : undefined,
  });

  const portalRoot = useMemo(() => (typeof document === "undefined" ? null : document.body), []);

  if (!portalRoot) return null;

  const reduced = prefersReducedMotion();

  // Non-animated fallback for reduced motion
  if (reduced) {
    if (!isOpen) return null;
    return createPortal(
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center p-4",
          positionClassName,
        )}
      >
        <div
          className={cn("absolute inset-0 bg-black/50", backdropClassName)}
          onClick={closeOnBackdrop ? onClose : undefined}
          aria-hidden="true"
        />
        <div
          {...containerProps}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          className={cn("relative z-10", contentClassName)}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>,
      portalRoot,
    );
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center p-4",
            positionClassName,
          )}
        >
          <motion.div
            className={cn("absolute inset-0 bg-black/50", backdropClassName)}
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={closeOnBackdrop ? onClose : undefined}
            aria-hidden="true"
          />
          <motion.div
            {...containerProps}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            className={cn("relative z-10", contentClassName)}
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    portalRoot,
  );
}

export default DialogOverlay;
