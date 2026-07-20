import React from "react";
import { motion } from "framer-motion";
import { useMotionConfig } from '@/lib/motion';

interface HeroSectionProps {
    todayFormatted: string;
    sectionCount: number;
    readTimeMin: number;
    isLiveData_?: boolean;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
    todayFormatted,
    sectionCount,
    readTimeMin,
    isLiveData_ = false,
}) => {
    const { instant, transition } = useMotionConfig();
    return (
        <header className="relative mb-12 px-6 py-12 sm:px-12 sm:py-20 max-w-[1400px] mx-auto">
            <div className="relative z-10 mx-auto max-w-4xl text-center">
                {/* Top Badge - Minimal */}
                <motion.div
                    initial={{ opacity: 0, y: instant ? 0 : 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={transition({ duration: 0.6, ease: "easeOut" })}
                    className="mb-8 flex justify-center"
                >
                    <div className="inline-flex items-center gap-3 rounded-full border border-edge bg-surface px-4 py-1.5 text-sm font-medium">
                        <span className="relative flex h-2 w-2">
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500"></span>
                        </span>
                        <span className="text-content">{todayFormatted}</span>
                        <span className="text-[color:var(--bg-tertiary)]">|</span>
                        <span className="text-content font-bold tracking-wide text-xs">
                            Daily Brief
                        </span>
                    </div>
                </motion.div>

                {/* Main Title - Huge & Clean */}
                <motion.h1
                    initial={{ opacity: 0, y: instant ? 0 : 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={transition({ duration: 0.8, delay: 0.1, ease: "easeOut" })}
                    className="mb-6 text-5xl font-bold tracking-tighter text-content sm:text-7xl lg:text-8xl"
                >
                    The Morning
                    <br />
                    <span className="text-content-secondary">
                        Report
                    </span>
                </motion.h1>

                {/* Subtitle - Crisp */}
                <motion.p
                    initial={{ opacity: 0, y: instant ? 0 : 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={transition({ duration: 0.8, delay: 0.2, ease: "easeOut" })}
                    className="mx-auto mb-10 max-w-2xl text-lg text-content-secondary sm:text-xl leading-relaxed font-medium"
                >
                    AI-synthesized briefing on infrastructure, trends, and deep dives.
                    <br className="hidden sm:block" />
                    <span className="text-content">
                        {readTimeMin} min read
                    </span>{" "}
                    covering{" "}
                    <span className="text-content">
                        {sectionCount} stories
                    </span>
                    .
                </motion.p>

                {/* Call to Action - High Contrast */}
                <motion.div
                    initial={{ opacity: 0, scale: instant ? 1 : 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={transition({ duration: 0.5, delay: 0.4 })}
                    className="flex justify-center"
                >
                    <button
                        type="button"
                        className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-content px-8 py-3 text-sm font-bold text-surface transition-all hover:bg-content/90 shadow-lg"
                    >
                        <span>Start Reading</span>
                        <svg
                            className="h-4 w-4 transition-transform group-hover:translate-x-1"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M17 8l4 4m0 0l-4 4m4-4H3"
                            />
                        </svg>
                    </button>
                </motion.div>
            </div>
        </header>
    );
};

export default HeroSection;
