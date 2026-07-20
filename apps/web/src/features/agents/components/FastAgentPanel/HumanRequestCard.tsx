// src/components/FastAgentPanel/HumanRequestCard.tsx
// UI component for displaying and responding to human-in-the-loop requests

import React, { useState, useRef, useEffect } from 'react';
import { MessageCircleQuestion, Send, X, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMutation } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { toast } from 'sonner';
import type { Id } from '../../../../../convex/_generated/dataModel';

interface HumanRequest {
  _id: Id<'humanRequests'>;
  userId: Id<'users'>;
  threadId: string;
  messageId: string;
  toolCallId: string;
  question: string;
  context?: string;
  options?: string[];
  status: 'pending' | 'answered' | 'cancelled';
  response?: string;
  respondedAt?: number;
  _creationTime: number;
}

interface HumanRequestCardProps {
  request: HumanRequest;
  onRespond?: () => void;
}

/**
 * HumanRequestCard - Displays a pending human request from an agent
 * 
 * Features:
 * - Shows question and context
 * - Provides quick-select options if available
 * - Allows free-form text response
 * - Shows status (pending/answered/cancelled)
 * - Animated appearance
 */
export function HumanRequestCard({ request, onRespond }: HumanRequestCardProps) {
  const [response, setResponse] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Track when user started viewing this request
  const viewStartTimeRef = useRef<number>(Date.now());

  // Reset start time if request changes
  useEffect(() => {
    viewStartTimeRef.current = Date.now();
  }, [request._id]);

  const respondToRequest = useMutation(api.domains.agents.humanInTheLoop.respondToRequest);
  const cancelRequest = useMutation(api.domains.agents.humanInTheLoop.cancelRequest);
  const recordDecision = useMutation(api.domains.hitl.decisions.recordHumanDecision);

  const handleSubmit = async () => {
    const finalResponse = selectedOption || response.trim();
    if (!finalResponse) {
      toast.error('Please provide a response');
      return;
    }

    setIsSubmitting(true);
    const reviewTimeMs = Date.now() - viewStartTimeRef.current;

    try {
      // Submit the response
      await respondToRequest({
        requestId: request._id,
        response: finalResponse,
      });

      // Record the decision for analytics
      await recordDecision({
        requestId: request._id,
        requestType: 'human_input',
        decision: 'approved',
        reviewTimeMs,
        feedback: selectedOption ? `Selected option: ${selectedOption}` : undefined,
        confidence: selectedOption ? 1.0 : 0.8, // Higher confidence for predefined options
      }).catch((err) => {
        // Don't block on analytics failure
      });

      toast.success('Response sent to agent');
      onRespond?.();
    } catch (err) {
      console.error('[HumanRequestCard] Failed to submit response:', err);
      toast.error('Failed to send response');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setIsSubmitting(true);
    const reviewTimeMs = Date.now() - viewStartTimeRef.current;

    try {
      // Cancel the request
      await cancelRequest({ requestId: request._id });

      // Record the cancellation as a rejected decision
      await recordDecision({
        requestId: request._id,
        requestType: 'human_input',
        decision: 'rejected',
        reviewTimeMs,
        feedback: 'User cancelled the request',
        reasoning: 'User explicitly cancelled without providing a response',
      }).catch((err) => {
        // Don't block on analytics failure
      });

      toast.info('Request cancelled');
      onRespond?.();
    } catch (err) {
      console.error('[HumanRequestCard] Failed to cancel request:', err);
      toast.error('Failed to cancel request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOptionSelect = (option: string) => {
    setSelectedOption(option === selectedOption ? null : option);
    setResponse(''); // Clear text input when selecting option
  };

  const isPending = request.status === 'pending';
  const isAnswered = request.status === 'answered';
  const isCancelled = request.status === 'cancelled';

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-4 shadow-md animate-in slide-in-from-top-2 duration-300",
        isPending && "border-indigo-500/30 bg-indigo-500/10",
        isAnswered && "border-green-400 bg-green-50",
        isCancelled && "border-content-muted bg-surface-secondary"
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={cn(
          "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
          isPending && "bg-indigo-500/10",
          isAnswered && "bg-green-100",
          isCancelled && "bg-surface-hover"
        )}>
          {isPending && <MessageCircleQuestion className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          {isAnswered && <CheckCircle2 className="h-5 w-5 text-green-600" />}
          {isCancelled && <X className="h-5 w-5 text-content-secondary" />}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={cn(
              "text-sm font-semibold",
              isPending && "text-content",
              isAnswered && "text-green-900",
              isCancelled && "text-content"
            )}>
              {isPending && 'Agent needs your input'}
              {isAnswered && 'Answered'}
              {isCancelled && 'Cancelled'}
            </h3>
            <div className="flex items-center gap-1 text-xs text-content-secondary">
              <Clock className="h-3 w-3" />
              <span>{new Date(request._creationTime).toLocaleTimeString()}</span>
            </div>
          </div>
          
          {/* Question */}
          <p className={cn(
            "text-sm font-medium mb-2",
            isPending && "text-content",
            isAnswered && "text-green-800",
            isCancelled && "text-content"
          )}>
            {request.question}
          </p>
          
          {/* Context */}
          {request.context && (
            <p className="text-xs text-content-secondary mb-3 italic">
              {request.context}
            </p>
          )}
        </div>
      </div>

      {/* Options (if provided) */}
      {isPending && request.options && request.options.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-content mb-2">Quick options:</p>
          <div className="flex flex-wrap gap-2">
            {request.options.map((option, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleOptionSelect(option)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                  "border-2",
                  selectedOption === option
                    ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                    : "border-edge bg-surface text-content hover:border-indigo-500/30/40 hover:bg-indigo-500/10"
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Text input (if no option selected) */}
      {isPending && !selectedOption && (
        <div className="mb-3">
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Type your response..."
            rows={2}
            className="w-full px-3 py-2 border border-edge rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <p className="text-xs text-content-secondary mt-1">Ctrl/Cmd + Enter to send</p>
        </div>
      )}

      {/* Answered response */}
      {isAnswered && request.response && (
        <div className="mb-3 p-3 bg-surface rounded-md border border-green-200">
          <p className="text-xs font-medium text-green-700 mb-1">Your response:</p>
          <p className="text-sm text-content">{request.response}</p>
        </div>
      )}

      {/* Actions */}
      {isPending && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || (!selectedOption && !response.trim())}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              "bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Send className="h-4 w-4" />
            {isSubmitting ? 'Sending...' : 'Send Response'}
          </button>

          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            title="Cancel request"
            aria-label="Cancel request"
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              "border border-edge bg-surface text-content hover:bg-surface-hover",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * HumanRequestList - Container for multiple human requests
 */
interface HumanRequestListProps {
  requests: HumanRequest[];
  onRespond?: () => void;
}

export function HumanRequestList({ requests, onRespond }: HumanRequestListProps) {
  if (requests.length === 0) return null;

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const answeredRequests = requests.filter(r => r.status === 'answered');

  return (
    <div className="space-y-3">
      {/* Pending requests first */}
      {pendingRequests.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-content-secondary tracking-wide flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4" />
            Pending Requests ({pendingRequests.length})
          </h3>
          {pendingRequests.map(request => (
            <HumanRequestCard
              key={request._id}
              request={request}
              onRespond={onRespond}
            />
          ))}
        </div>
      )}

      {/* Answered requests (collapsed by default) */}
      {answeredRequests.length > 0 && (
        <details className="group">
          <summary className="text-xs font-semibold text-content-secondary tracking-wide cursor-pointer list-none flex items-center gap-2 hover:text-content">
            <CheckCircle2 className="h-4 w-4" />
            Answered Requests ({answeredRequests.length})
          </summary>
          <div className="mt-3 space-y-3">
            {answeredRequests.map(request => (
              <HumanRequestCard
                key={request._id}
                request={request}
                onRespond={onRespond}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}


