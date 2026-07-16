/**
 * ChatLane — Left panel for conversation, suggestions, and quick actions.
 *
 * A focused chat interface that anchors the composer at the bottom
 * and displays thread messages, suggestions, and quick actions above.
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import type { LensId } from "@/features/controlPlane/components/searchTypes";

// Types
interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
  suggestions?: QuickAction[];
}

interface QuickAction {
  id: string;
  label: string;
  icon?: React.ElementType;
  onClick: () => void;
}

interface ChatLaneProps {
  /** Thread title */
  threadTitle?: string;
  /** Messages in the thread */
  messages: Message[];
  /** Currently streaming/loading */
  isLoading?: boolean;
  /** Quick actions suggested based on context */
  quickActions?: QuickAction[];
  /** Composer value */
  inputValue: string;
  /** Composer change handler */
  onInputChange: (value: string) => void;
  /** Composer submit handler */
  onSubmit: () => void;
  /** Current lens */
  lens: LensId;
  /** Lens change handler */
  onLensChange: (lens: LensId) => void;
  /** Whether composer is disabled */
  disabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Optional className */
  className?: string;
  /** Thread collapse handler */
  onThreadCollapse?: () => void;
  /** Whether thread is collapsed */
  threadCollapsed?: boolean;
}

// Lens options
const LENS_OPTIONS: { id: LensId; label: string; shortcut: string }[] = [
  { id: "founder", label: "Founder", shortcut: "F" },
  { id: "investor", label: "Investor", shortcut: "I" },
  { id: "engineer", label: "Engineer", shortcut: "E" },
  { id: "pm", label: "PM", shortcut: "P" },
];

function MessageBubble({
  message,
  isLast,
}: {
  message: Message;
  isLast?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex flex-col gap-1",
        isUser ? "items-end" : "items-start"
      )}
    >
      {/* Message content */}
      <div
        className={cn(
          "max-w-[90%] px-4 py-2.5 rounded-2xl text-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        )}
      >
        {message.content}
      </div>

      {/* Suggested actions for assistant messages */}
      {!isUser && message.suggestions && message.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {message.suggestions.map((action) => (
            <button
              key={action.id}
              onClick={action.onClick}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-muted/80 hover:bg-muted rounded-full transition-colors"
            >
              {action.icon && <action.icon className="w-3 h-3" />}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function LensSelector({
  value,
  onChange,
}: {
  value: LensId;
  onChange: (lens: LensId) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = LENS_OPTIONS.find((l) => l.id === value);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-muted/80 hover:bg-muted rounded-lg transition-colors"
      >
        <Sparkles className="w-3 h-3 text-primary" />
        <span>{selected?.label}</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 mb-1 bg-popover border border-border rounded-lg shadow-lg p-1 min-w-[120px]"
          >
            {LENS_OPTIONS.map((lens) => (
              <button
                key={lens.id}
                onClick={() => {
                  onChange(lens.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center justify-between w-full px-3 py-2 text-sm rounded-md transition-colors",
                  value === lens.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                )}
              >
                <span>{lens.label}</span>
                <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] bg-muted rounded">
                  {lens.shortcut}
                </kbd>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ChatLane({
  threadTitle = "New conversation",
  messages,
  isLoading,
  quickActions,
  inputValue,
  onInputChange,
  onSubmit,
  lens,
  onLensChange,
  disabled,
  placeholder = "Ask anything...",
  className,
  onThreadCollapse,
  threadCollapsed,
}: ChatLaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [textareaHeight, setTextareaHeight] = useState(40);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const newHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = `${newHeight}px`;
    setTextareaHeight(newHeight);
  }, [inputValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (inputValue.trim() && !disabled) {
          onSubmit();
        }
      }
    },
    [inputValue, disabled, onSubmit]
  );

  const suggestions = quickActions ?? [];

  return (
    <div className={cn("flex flex-col h-full bg-muted/20", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background/50">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm truncate">{threadTitle}</span>
        </div>
        <div className="flex items-center gap-1">
          {onThreadCollapse && (
            <button
              onClick={onThreadCollapse}
              className="p-1.5 hover:bg-muted rounded-md transition-colors"
              aria-label={threadCollapsed ? "Expand thread" : "Collapse thread"}
            >
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform",
                  threadCollapsed && "-rotate-90"
                )}
              />
            </button>
          )}
        </div>
      </div>

      {/* Thread messages */}
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 overflow-y-auto p-4 space-y-4",
          threadCollapsed && "hidden"
        )}
      >
        {messages.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground max-w-[200px]">
              Start a conversation to research and build reports
            </p>
          </div>
        ) : (
          messages.map((message, idx) => (
            <MessageBubble
              key={message.id}
              message={message}
              isLast={idx === messages.length - 1}
            />
          ))
        )}

        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <div className="flex gap-1">
              <span
                className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
            <span className="text-xs">Thinking...</span>
          </motion.div>
        )}
      </div>

      {/* Quick actions */}
      {!threadCollapsed && messages.length > 0 && suggestions.length > 0 && (
        <div className="px-4 py-2 border-t border-border/30">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Suggested actions
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 4).map((action) => (
              <button
                key={action.id}
                onClick={action.onClick}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-background border border-border/50 hover:border-border hover:bg-muted/50 rounded-lg transition-all"
              >
                {action.icon && <action.icon className="w-3 h-3 text-muted-foreground" />}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="p-3 border-t border-border/50 bg-background">
        <div className="relative bg-muted/50 rounded-xl border border-border/50 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          {/* Text input */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full px-3 py-2.5 bg-transparent resize-none outline-none text-sm min-h-[40px] max-h-[120px]"
            style={{ height: textareaHeight }}
            rows={1}
          />

          {/* Composer actions */}
          <div className="flex items-center justify-between px-2 pb-2">
            {/* Left: Lens selector */}
            <div className="flex items-center gap-1">
              <LensSelector value={lens} onChange={onLensChange} />
            </div>

            {/* Right: Send button */}
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={!inputValue.trim() || disabled}
              className="h-7 px-2.5"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </Button>
          </div>
        </div>

        {/* Hint */}
        <p className="text-[10px] text-muted-foreground text-center mt-1.5">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
