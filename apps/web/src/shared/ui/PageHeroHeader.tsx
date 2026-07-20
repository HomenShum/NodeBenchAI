import React, { ReactNode } from "react";
import { motion } from "framer-motion";
import { SignatureOrb } from "./SignatureOrb";
import { useMotionConfig } from "@/lib/motion";
import { springs } from "@/utils/animations";

interface PageHeroHeaderProps {
  icon?: ReactNode; // Emoji or icon element before title
  title: ReactNode;
  date?: ReactNode; // small muted date element to the right of title
  subtitle?: ReactNode;
  presets?: ReactNode; // optional row of preset buttons/controls
  className?: string;
  /** Enable premium underline accent on title (like WelcomeLanding) */
  accent?: boolean;
}

const headerStagger = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const headerChild = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: springs.smooth },
};

/**
 * Standardized hero header used below the top divider bar.
 * Premium SaaS styling with staggered entrance animation.
 */
export function PageHeroHeader({ icon, title, date, subtitle, presets, className, accent = false }: PageHeroHeaderProps) {
  const { instant } = useMotionConfig();
  const Wrapper = instant ? "div" : motion.div;
  const Child = instant ? "div" : motion.div;

  return (
    <Wrapper
      className={`relative ${className ?? ""}`}
      {...(!instant && { variants: headerStagger, initial: "hidden", animate: "visible" })}
    >
      <SignatureOrb variant="ambient" className="top-[-100px] right-[-80px] opacity-60" />
      <Child
        className="relative flex items-center justify-between gap-4 mb-2"
        {...(!instant && { variants: headerChild })}
      >
        <h1 className="type-page-title text-content flex items-center gap-3">
          {icon && <span className="text-xl opacity-90">{icon}</span>}
          {accent ? (
            <span className="underline decoration-content/40 decoration-[3px] underline-offset-[8px]">{title}</span>
          ) : (
            <span>{title}</span>
          )}
        </h1>
        {date && (
          <span className="text-sm font-medium text-content-muted tabular-nums whitespace-nowrap font-sans">{date}</span>
        )}
      </Child>
      {subtitle && (
        <Child
          className="text-content-secondary text-sm leading-relaxed max-w-xl"
          {...(!instant && { variants: headerChild })}
        >
          {subtitle}
        </Child>
      )}
      {presets && (
        <Child
          className="mt-5 pb-2 flex flex-wrap gap-2"
          {...(!instant && { variants: headerChild })}
        >
          {presets}
        </Child>
      )}
    </Wrapper>
  );
}

