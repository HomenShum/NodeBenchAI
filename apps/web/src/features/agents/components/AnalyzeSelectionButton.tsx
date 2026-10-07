/**
 * AnalyzeSelectionButton - Reusable button for "Chat with Selection" feature
 * 
 * Purple gradient button that sends selected content to Fast Agent.
 * Can be placed in any document viewer toolbar.
 */

import React, { useState, useCallback } from 'react';
import { Sparkles, Loader2, Check, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useSelection, type SelectionMetadata } from '../context/SelectionContext';

interface AnalyzeSelectionButtonProps {
  /** Selected content to analyze */
  selectedContent: string;
  /** Metadata about the selection */
  metadata: SelectionMetadata;
  /** Whether the button should be disabled */
  disabled?: boolean;
  /** Custom class name */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show text label */
  showLabel?: boolean;
  /** Callback when analysis is triggered */
  onAnalyze?: () => void;
  /** Optional: directly open Fast Agent panel */
  openFastAgent?: () => void;
}

export function AnalyzeSelectionButton({
  selectedContent,
  metadata,
  disabled = false,
  className = '',
  size = 'md',
  showLabel = true,
  onAnalyze,
  openFastAgent,
}: AnalyzeSelectionButtonProps) {
  const { setSelection, hasSelection } = useSelection();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const hasContent = selectedContent.trim().length > 0;
  const isDisabled = disabled || !hasContent || isLoading;

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs gap-1',
    md: 'px-3 py-1.5 text-sm gap-1.5',
    lg: 'px-4 py-2 text-sm gap-2',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-4 h-4',
  };

  const handleClick = useCallback(async () => {
    if (isDisabled) return;

    setIsLoading(true);
    
    try {
      // Set the selection in context
      setSelection(selectedContent, metadata);
      
      // Call optional callbacks
      onAnalyze?.();
      
      // Open Fast Agent panel if callback provided
      if (openFastAgent) {
        openFastAgent();
      }

      // Show success state briefly
      setIsSuccess(true);
      toast.success(`Selection ready! Open Fast Agent to analyze.`, {
        description: `${metadata.rangeDescription || 'Content'} from "${metadata.filename}"`,
        duration: 3000,
      });

      setTimeout(() => {
        setIsSuccess(false);
      }, 2000);

    } catch (error) {
      console.error('Failed to set selection:', error);
      toast.error('Failed to prepare selection for analysis');
    } finally {
      setIsLoading(false);
    }
  }, [isDisabled, selectedContent, metadata, setSelection, onAnalyze, openFastAgent]);

  // Determine button content
  const renderIcon = () => {
    if (isLoading) return <Loader2 className={`${iconSizes[size]} motion-safe:animate-spin`} />;
    if (isSuccess) return <Check className={iconSizes[size]} />;
    return <Sparkles className={iconSizes[size]} />;
  };

  const renderLabel = () => {
    if (!showLabel) return null;
    if (isLoading) return 'Preparing...';
    if (isSuccess) return 'Ready!';
    if (!hasContent) return 'Select content';
    return 'Analyze Selection';
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      className={`
        inline-flex items-center ${sizeClasses[size]} font-medium rounded-lg
        transition-all shadow-lg
        ${isSuccess 
          ? 'bg-green-500 text-white shadow-green-500/25' 
          : 'bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white shadow-purple-500/25'
        }
        ${isDisabled && !isSuccess ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
      title={hasContent 
        ? `Analyze: ${metadata.rangeDescription || 'selected content'} from ${metadata.filename}`
        : 'Select content first'
      }
    >
      {renderIcon()}
      {renderLabel()}
    </button>
  );
}

/** Compact icon-only variant for toolbars */
export function AnalyzeSelectionIconButton(props: Omit<AnalyzeSelectionButtonProps, 'showLabel' | 'size'>) {
  return <AnalyzeSelectionButton {...props} showLabel={false} size="sm" />;
}

export default AnalyzeSelectionButton;

