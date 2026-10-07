/**
 * Interactive Onboarding Flow
 * Guided tour for new users with step-by-step feature introduction
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  CheckSquare,
  Calendar,
  Sparkles,
  Command,
  Mic,
  ArrowRight,
  ArrowLeft,
  X,
  Check,
} from 'lucide-react';
import { scaleFadeVariants, springs } from '../../../utils/animations';
import { useMotionConfig } from '@/lib/motion';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: typeof FileText;
  color: string;
  tip?: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    description: 'Your intelligent workspace for documents, tasks, and AI-powered research. Let\'s take a quick tour!',
    icon: Sparkles,
    color: 'bg-purple-500',
  },
  {
    id: 'documents',
    title: 'Create Documents',
    description: 'Write notes, research documents, and reports. Use hashtags to organize and connect your content.',
    icon: FileText,
    color: 'bg-blue-500',
    tip: 'Try typing #topic to create linked documents',
  },
  {
    id: 'tasks',
    title: 'Manage Tasks',
    description: 'Track your to-dos with smart task management. Set priorities, due dates, and link tasks to documents.',
    icon: CheckSquare,
    color: 'bg-green-500',
    tip: 'Tasks sync with your calendar automatically',
  },
  {
    id: 'calendar',
    title: 'Calendar Integration',
    description: 'View your schedule, events, and deadlines in one place. Plan your day with the integrated calendar.',
    icon: Calendar,
    color: 'bg-amber-500',
  },
  {
    id: 'command',
    title: 'Command Palette',
    description: 'Press Cmd/Ctrl+K to quickly navigate, search, and execute actions from anywhere.',
    icon: Command,
    color: 'bg-gray-700',
    tip: 'This is your power-user shortcut!',
  },
  {
    id: 'voice',
    title: 'Voice & Quick Capture',
    description: 'Use the floating button to quickly capture notes, voice memos, or screenshots.',
    icon: Mic,
    color: 'bg-red-500',
    tip: 'Look for the + button in the corner',
  },
];

interface OnboardingFlowProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingFlow({ onComplete, onSkip }: OnboardingFlowProps) {
  const { instant, transition } = useMotionConfig();
  const [currentStep, setCurrentStep] = useState(0);
  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
  const isFirstStep = currentStep === 0;

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }, [isLastStep, onComplete]);

  const handlePrev = useCallback(() => {
    if (!isFirstStep) {
      setCurrentStep((s) => s - 1);
    }
  }, [isFirstStep]);

  const Icon = step.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <motion.div
        className="bg-surface rounded-lg shadow-2xl max-w-md w-full mx-4 overflow-hidden"
        variants={instant ? undefined : scaleFadeVariants}
        initial={instant ? undefined : "hidden"}
        animate={instant ? undefined : "visible"}
      >
        {/* Header */}
        <div className={`${step.color} p-8 text-white relative`}>
          <button onClick={onSkip} className="absolute top-4 right-4 p-1 rounded-full hover:bg-white/20 transition-colors" aria-label="Skip onboarding">
            <X className="h-5 w-5" />
          </button>
          <motion.div key={step.id} initial={instant ? undefined : { scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={transition(springs.bouncy)} className="w-16 h-16 bg-white/20 rounded-lg flex items-center justify-center mb-4">
            <Icon className="h-8 w-8" />
          </motion.div>
          <h2 className="text-2xl font-bold">{step.title}</h2>
        </div>

        {/* Content */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            <motion.div key={step.id} initial={instant ? { opacity: 1 } : { opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={instant ? { opacity: 0 } : { opacity: 0, x: -20 }} transition={transition({ duration: 0.2 })}>
              <p className="text-content-secondary mb-4">{step.description}</p>
              {step.tip && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
                  💡 <strong>Tip:</strong> {step.tip}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Progress */}
          <div className="flex items-center gap-1 mt-6 mb-4">
            {ONBOARDING_STEPS.map((_, idx) => (
              <div key={idx} className={`h-1 flex-1 rounded-full transition-colors ${idx <= currentStep ? 'bg-blue-500' : 'bg-surface-secondary'}`} />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button onClick={handlePrev} disabled={isFirstStep} className={`flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isFirstStep ? 'text-gray-300 dark:text-content-secondary cursor-not-allowed' : 'text-content-secondary hover:bg-surface-hover'}`}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button onClick={handleNext} className="flex items-center gap-1 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
              {isLastStep ? (
                <>
                  Get Started <Check className="h-4 w-4" />
                </>
              ) : (
                <>
                  Next <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default OnboardingFlow;

