import { ArrowRight, Search, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";

type ResearchMode = "quick" | "deep";

interface MagicInputContainerProps {
    onRun: (prompt: string, options?: { mode?: ResearchMode }) => void;
    onDeepRun?: (prompt: string) => void;
    compact?: boolean;
    defaultValue?: string;
    mode?: ResearchMode;
}

export default function MagicInputContainer({ onRun, onDeepRun, compact = false, defaultValue = "", mode = "quick" }: MagicInputContainerProps) {
    const [prompt, setPrompt] = useState(defaultValue);

    useEffect(() => {
        if (defaultValue) {
            setPrompt(defaultValue);
        }
    }, [defaultValue]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        const isMetaEnter = e.key === "Enter" && (e.metaKey || e.ctrlKey);
        const isPlainEnter = e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey;

        if (isMetaEnter) {
            e.preventDefault();
            if (onDeepRun) {
                onDeepRun(prompt);
            } else {
                onRun(prompt, { mode: "deep" });
            }
            return;
        }

        if (isPlainEnter) {
            e.preventDefault();
            onRun(prompt, { mode });
        }
    };

    if (compact) {
        return (
            <div className="max-w-4xl mx-auto w-full">
                <div className="relative w-full h-12 group">
                    {/* Icon (Absolute Left) */}
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-content-secondary pointer-events-none z-10">
                        <Sparkles className="w-4 h-4" />
                    </div>

                    {/* The Actual Input Field */}
                    <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full h-full pl-10 pr-12 rounded-lg border border-edge bg-surface text-sm text-content placeholder:text-content-secondary outline-none transition-all focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 shadow-sm"
                        placeholder="Ask anything..."
                    />

                    {/* Button (Absolute Right) */}
                    <button
                        type="button"
                        onClick={() => onRun(prompt, { mode })}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 bg-content hover:bg-content/90 text-surface rounded-md transition-all shadow-sm hover:shadow disabled:opacity-50"
                        title="Generate (Enter for Quick, Cmd/Ctrl+Enter for Deep)"
                    >
                        <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-2xl mx-auto group relative z-20">
            <div className="absolute -inset-3 bg-gradient-to-r from-content/10 via-[color:var(--text-secondary)]/10 to-content/10 rounded-[2rem] blur-2xl opacity-40 group-hover:opacity-60 transition duration-1000"></div>

            <div className="relative flex items-center bg-surface rounded-lg shadow-sm h-14 w-full overflow-hidden border border-edge">
                <div className="absolute left-4 text-content-secondary pointer-events-none">
                    <Search className="w-5 h-5" />
                </div>

                <input
                    type="text"
                    className="w-full h-full bg-transparent text-base text-content placeholder:text-content-secondary pl-12 pr-12 outline-none border-none ring-0 focus:ring-0"
                    placeholder="Ask anything about companies, markets, or docs..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                />

                <div className="absolute right-2">
                    <button
                        type="button"
                        onClick={() => onRun(prompt, { mode })}
                        className="p-2 bg-content hover:bg-content/90 text-surface rounded-lg transition-all shadow active:scale-95 flex items-center justify-center"
                        title="Run research (Enter for Quick, Cmd/Ctrl+Enter for Deep)"
                    >
                        <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex justify-center gap-3 mt-3 text-xs text-content-secondary">
                <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-surface-secondary border border-edge rounded text-xs font-semibold">Enter</kbd>
                    <span className="ml-1">Quick Brief</span>
                </span>
                <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-surface-secondary border border-edge rounded text-xs font-semibold">⌘</kbd>
                    <span>+</span>
                    <kbd className="px-1.5 py-0.5 bg-surface-secondary border border-edge rounded text-xs font-semibold">Enter</kbd>
                    <span className="ml-1">Deep Report</span>
                </span>
            </div>
        </div>
    );
}
