import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetOverlay,
  SheetPortal,
} from "@/components/ai-ui/sheet";
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
  const reduced = prefersReducedMotion();
  return (
    <Sheet
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetPortal>
        <SheetOverlay
          asChild={!reduced}
          className={cn("z-50 bg-black/50", backdropClassName)}
          onPointerDown={(event) => {
            if (!closeOnBackdrop) event.preventDefault();
          }}
        >
          {reduced ? undefined : (
            <motion.div variants={backdropVariants} initial="hidden" animate="visible" exit="exit" />
          )}
        </SheetOverlay>
        <div className={cn("fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none", positionClassName)}>
          <SheetContent
            asChild={!reduced}
            showCloseButton={false}
            aria-label={ariaLabel}
            className={cn("relative z-10 pointer-events-auto", contentClassName)}
            onEscapeKeyDown={(event) => {
              if (!closeOnEscape) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (!closeOnBackdrop) event.preventDefault();
            }}
            onOpenAutoFocus={(event) => {
              if (!autoFocus) event.preventDefault();
            }}
          >
            {reduced ? (
              <div>{children}</div>
            ) : (
              <motion.div variants={contentVariants} initial="hidden" animate="visible" exit="exit">
                {children}
              </motion.div>
            )}
          </SheetContent>
        </div>
      </SheetPortal>
    </Sheet>
  );
}

export default DialogOverlay;
