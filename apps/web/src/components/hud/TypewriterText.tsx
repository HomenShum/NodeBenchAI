/**
 * TypewriterText — Streaming text with blinking cursor.
 *
 * Renders text that appears character-by-character from an LLM stream
 * with a blinking cursor block. The parent is responsible for passing
 * the incrementally-growing text string.
 */

import React from 'react';

interface TypewriterTextProps {
    /** The text to display. Pass the incrementally-growing stream text. */
    text: string;
    /** Whether the stream is active (shows the blinking cursor). */
    isStreaming?: boolean;
    /** Additional className. */
    className?: string;
}

export function TypewriterText({
    text,
    isStreaming = false,
    className = '',
}: TypewriterTextProps) {
    return (
        <>
            <span
                className={`typewriter-text font-mono text-sm leading-relaxed whitespace-pre-wrap text-content ${className}`}
            >
                {text}
                {isStreaming && <span className="typewriter-cursor" aria-hidden="true">█</span>}
            </span>

            <style>{`
        .typewriter-cursor {
          display: inline;
          animation: cursor-blink 1s step-end infinite;
          color: var(--color-primary, currentColor);
          opacity: 0.7;
        }

        @keyframes cursor-blink {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .typewriter-cursor { animation: none; opacity: 0.7; }
        }
        .reduce-motion .typewriter-cursor { animation: none; opacity: 0.7; }
      `}</style>
        </>
    );
}
