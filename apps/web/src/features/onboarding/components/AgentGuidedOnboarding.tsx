/**
 * AgentGuidedOnboarding
 * A scrollytelling-style onboarding flow explaining the difference
 * between Fast Agents and Deep Agents.
 */

import { useState } from "react";
import {
    Zap,
    Brain,
    MessageSquare,
    FileEdit,
    Clock,
    CheckCircle,
    ArrowRight,
    Sparkles,
    X
} from "lucide-react";

interface OnboardingStep {
    id: string;
    title: string;
    subtitle: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    features: string[];
}

const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        id: "welcome",
        title: "Meet Your AI Assistants",
        subtitle: "Two powerful agents, one unified experience",
        description: "Your AI workspace combines fast, conversational AI with deep, document-aware intelligence. Let's explore what each can do for you.",
        icon: <Sparkles className="w-8 h-8" />,
        color: "from-violet-500 to-purple-600",
        features: [
            "Real-time assistance for quick questions",
            "Deep analysis for complex research",
            "Seamless context switching",
        ],
    },
    {
        id: "fast-agent",
        title: "Fast Agent",
        subtitle: "Quick answers, instant actions",
        description: "The Fast Agent is your go-to for rapid interactions. Access it via the ⚡ button or slash commands in any document.",
        icon: <Zap className="w-8 h-8" />,
        color: "from-amber-400 to-orange-500",
        features: [
            "Chat-style Q&A with web search",
            "Slash commands: /search, /summarize, /translate",
            "Context-aware suggestions",
            "Works in seconds, not minutes",
        ],
    },
    {
        id: "deep-agent",
        title: "Deep Agent",
        subtitle: "Multi-step planning & document editing",
        description: "The Deep Agent handles complex tasks that require planning, memory, and persistent context across multiple steps.",
        icon: <Brain className="w-8 h-8" />,
        color: "from-blue-500 to-cyan-500",
        features: [
            "Creates and edits documents autonomously",
            "Builds research dossiers with citations",
            "Remembers context across sessions",
            "Plans multi-step workflows",
        ],
    },
    {
        id: "try-it",
        title: "Ready to Start?",
        subtitle: "Your workspace awaits",
        description: "Open a document and try the Fast Agent with a simple question, or ask the Deep Agent to research a topic for you.",
        icon: <CheckCircle className="w-8 h-8" />,
        color: "from-green-500 to-indigo-500",
        features: [
            "Type '/' in any document for commands",
            "Click ⚡ to open the Fast Agent panel",
            "Start a new dossier for deep research",
        ],
    },
];

interface AgentGuidedOnboardingProps {
    onComplete: () => void;
    onSkip?: () => void;
}

export function AgentGuidedOnboarding({ onComplete, onSkip }: AgentGuidedOnboardingProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const step = ONBOARDING_STEPS[currentStep];

    const handleNext = () => {
        if (currentStep < ONBOARDING_STEPS.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            onComplete();
        }
    };

    const handlePrevious = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="relative w-full max-w-2xl mx-4 bg-surface rounded-lg shadow-2xl overflow-hidden">
                {/* Skip button */}
                {onSkip && (
                    <button
                        onClick={onSkip}
                        className="absolute top-4 right-4 p-2 text-content-secondary hover:text-content hover:bg-surface-hover rounded-lg transition-colors z-10"
                        aria-label="Skip onboarding"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}

                {/* Progress dots */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-2">
                    {ONBOARDING_STEPS.map((_, idx) => (
                        <button
                            key={idx}
                            onClick={() => setCurrentStep(idx)}
                            className={`w-2 h-2 rounded-full transition-all ${idx === currentStep ? "w-6 bg-gray-900" : "bg-surface-secondary hover:bg-surface-hover"
                                }`}
                            aria-label={`Go to step ${idx + 1}`}
                        />
                    ))}
                </div>

                {/* Content */}
                <div className="pt-12 pb-6 px-8">
                    {/* Icon with gradient background */}
                    <div className={`w-16 h-16 rounded-lg bg-gradient-to-br ${step.color} flex items-center justify-center text-white shadow-lg mb-6`}>
                        {step.icon}
                    </div>

                    {/* Title */}
                    <h2 className="text-3xl font-bold text-content mb-1 tracking-tight">{step.title}</h2>
                    <p className="text-xs font-semibold text-content-secondary mb-4">{step.subtitle}</p>

                    {/* Description */}
                    <p className="text-content mb-8 leading-relaxed text-lg font-normal">{step.description}</p>

                    {/* Features */}
                    <ul className="space-y-3 mb-8">
                        {step.features.map((feature, idx) => (
                            <li key={idx} className="flex items-start gap-3 text-sm text-content">
                                <span className={`w-5 h-5 rounded-full bg-gradient-to-br ${step.color} flex items-center justify-center text-white text-xs shrink-0 mt-0.5`}>
                                    ✓
                                </span>
                                {feature}
                            </li>
                        ))}
                    </ul>

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                        <button
                            onClick={handlePrevious}
                            disabled={currentStep === 0}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${currentStep === 0
                                ? "text-content-secondary cursor-not-allowed"
                                : "text-content hover:bg-surface-hover"
                                }`}
                        >
                            Previous
                        </button>

                        <button
                            onClick={handleNext}
                            className={`flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg text-white bg-gradient-to-r ${step.color} hover:opacity-90 transition-opacity shadow-md`}
                        >
                            {currentStep === ONBOARDING_STEPS.length - 1 ? "Get Started" : "Next"}
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AgentGuidedOnboarding;
