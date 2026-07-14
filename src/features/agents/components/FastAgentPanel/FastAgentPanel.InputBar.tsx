// src/components/FastAgentPanel/FastAgentPanel.InputBar.tsx
// Enhanced input bar with auto-resize, context pills, drag-and-drop, and floating design

import React, { useState, useRef, useEffect, useCallback, KeyboardEvent, DragEvent } from 'react';
import { Send, Loader2, Paperclip, X, Mic, Video, Image as ImageIcon, FileText, ChevronUp, StopCircle, FolderOpen, Table2, Calendar, Zap, Gift, AlignLeft, AlignJustify, BookOpen } from 'lucide-react';
import { MediaRecorderComponent } from './FastAgentPanel.MediaRecorder';
import { FileDropOverlay } from '@/shared/components/FileDropOverlay';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useSelection } from '@/features/agents/context/SelectionContext';
import { InlineEnhancer } from './FastAgentPanel.PromptEnhancer';
import { useAction } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import {
  Context,
  ContextContent,
  ContextContentHeader,
  ContextTrigger,
} from '@/components/ai-elements/context';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';

// ============================================================================
// Spawn Command Parser (local to InputBar)
// ============================================================================

const AGENT_SHORTCUTS: Record<string, string> = {
  doc: "DocumentAgent",
  media: "MediaAgent",
  sec: "SECAgent",
  finance: "OpenBBAgent",
  research: "EntityResearchAgent",
};

const VALID_AGENTS = [
  "DocumentAgent",
  "MediaAgent",
  "SECAgent",
  "OpenBBAgent",
  "EntityResearchAgent",
] as const;

/**
 * Parse a /spawn command and extract query + agents
 * Format: /spawn "query" --agents=doc,media,sec
 * Or: /spawn query --agents=doc,media,sec
 */
function parseSpawnCommandLocal(input: string): { query: string; agents: string[] } | null {
  // Match: /spawn "query" --agents=doc,media,sec
  // Or: /spawn query --agents=doc,media,sec
  const spawnMatch = input.match(/^\/spawn\s+(.+?)(?:\s+--agents?=([^\s]+))?$/i);
  if (!spawnMatch) return null;

  let query = spawnMatch[1].trim();
  // Remove quotes if present
  if ((query.startsWith('"') && query.endsWith('"')) ||
      (query.startsWith("'") && query.endsWith("'"))) {
    query = query.slice(1, -1);
  }

  // Parse agents
  let agents: string[] = [];
  if (spawnMatch[2]) {
    agents = spawnMatch[2].split(",").map((a) => {
      const trimmed = a.trim().toLowerCase();
      return AGENT_SHORTCUTS[trimmed] || trimmed;
    });
  } else {
    // Default agents if none specified
    agents = ["DocumentAgent", "MediaAgent", "SECAgent"];
  }

  // Validate agents
  agents = agents.filter((a) =>
    VALID_AGENTS.includes(a as typeof VALID_AGENTS[number])
  );

  if (agents.length === 0) {
    agents = ["DocumentAgent", "MediaAgent", "SECAgent"];
  }

  return { query, agents };
}

// ============================================================================
// Slash Commands Definition
// ============================================================================

interface SlashCommand {
  command: string;
  label: string;
  description: string;
  example: string;
  icon: React.ReactNode;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: "/spawn",
    label: "Start Team",
    description: "Run multiple AI agents in parallel",
    example: '/spawn "Tesla analysis" --agents=doc,media,sec',
    icon: <Zap className="w-4 h-4" />,
  },
  {
    command: "/spawn",
    label: "Deep Research",
    description: "Research with Doc, Media, and SEC agents",
    example: '/spawn "query" --agents=doc,media,sec',
    icon: <FileText className="w-4 h-4" />,
  },
  {
    command: "/spawn",
    label: "Financial Analysis",
    description: "SEC filings, market data, and documents",
    example: '/spawn "query" --agents=sec,finance,doc',
    icon: <Table2 className="w-4 h-4" />,
  },
  {
    command: "/spawn",
    label: "Entity Deep Dive",
    description: "Profile companies and relationships",
    example: '/spawn "query" --agents=research,doc,sec',
    icon: <FolderOpen className="w-4 h-4" />,
  },
];

// Import from SINGLE SOURCE OF TRUTH for models
import {
  getModelUIList,
  MODEL_UI_INFO,
  type ApprovedModel,
} from '@shared/llm/approvedModels';

// Get models from shared module
const APPROVED_MODEL_LIST = getModelUIList();

function parseContextWindow(contextWindow?: string): number {
  const match = contextWindow?.trim().match(/^(\d+(?:\.\d+)?)([KM])?$/i);
  if (!match) return 128_000;

  const value = Number.parseFloat(match[1]);
  const multiplier = match[2]?.toUpperCase() === 'M'
    ? 1_000_000
    : match[2]?.toUpperCase() === 'K'
      ? 1_000
      : 1;
  return Math.max(1, Math.round(value * multiplier));
}

// File size limits
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Document context item for drag-and-drop
export interface DocumentContextItem {
  id: string;
  title: string;
  type?: 'document' | 'dossier' | 'note';
  analyzing?: boolean;
}

// Calendar event context item for drag-and-drop
export interface CalendarEventContextItem {
  id: string;
  title: string;
  startTime: number;
  endTime?: number;
  allDay?: boolean;
  location?: string;
  description?: string;
}

interface FastAgentInputBarProps {
  id?: string;
  input: string;
  setInput: (value: string) => void;
  onSend: (content?: string) => void;
  isStreaming: boolean;
  onStop: () => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  attachedFiles: File[];
  onAttachFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  selectedDocumentIds?: Set<string>; // For context pills
  contextDocuments?: DocumentContextItem[]; // Enhanced document context
  onAddContextDocument?: (doc: DocumentContextItem) => void;
  onRemoveContextDocument?: (docId: string) => void;
  // Calendar event context
  contextCalendarEvents?: CalendarEventContextItem[];
  onAddCalendarEvent?: (event: CalendarEventContextItem) => void;
  onRemoveCalendarEvent?: (eventId: string) => void;
  // Prompt enhancement
  threadId?: string; // For memory context
  enableEnhancement?: boolean; // Enable Ctrl+P prompt enhancement
  placeholder?: string;
  maxLength?: number;
  // Swarm support
  onSpawn?: (query: string, agents: string[]) => void; // Handler for /spawn commands
  // Response length control
  responseLength?: 'brief' | 'detailed' | 'exhaustive';
  onResponseLengthChange?: (length: 'brief' | 'detailed' | 'exhaustive') => void;
  /** Voice intent router — intercepts UI commands before agent send. Return true if handled. */
  onVoiceIntent?: (text: string, source?: 'voice' | 'text') => boolean;
  /** Compact presentation for the cockpit sidebar variant. */
  compact?: boolean;
}

/**
 * FastAgentInputBar - Floating input container with context pills and model selection
 */
export function FastAgentInputBar({
  id: _id,
  input,
  setInput,
  onSend,
  isStreaming,
  onStop,
  selectedModel,
  onSelectModel,
  attachedFiles,
  onAttachFiles,
  onRemoveFile,
  selectedDocumentIds,
  contextDocuments = [],
  onAddContextDocument,
  onRemoveContextDocument,
  contextCalendarEvents = [],
  onAddCalendarEvent,
  onRemoveCalendarEvent,
  threadId,
  enableEnhancement = true,
  placeholder = 'Ask NodeBench...',
  maxLength = 10000,
  onSpawn,
  responseLength = 'detailed',
  onResponseLengthChange,
  onVoiceIntent,
  compact = false,
}: FastAgentInputBarProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'audio' | 'video' | null>(null);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragType, setDragType] = useState<'document' | 'calendar' | 'file' | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showSlashCommands, setShowSlashCommands] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  // Inline @mentions autocomplete
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const MENTION_OPTIONS = [
    { label: '@web', description: 'Search the web', icon: 'WEB' },
    { label: '@docs', description: 'Search documents', icon: 'DOC' },
    { label: '@code', description: 'Analyze code', icon: 'DEV' },
    { label: '@data', description: 'Query data sources', icon: 'DB' },
    { label: '@deep', description: 'Deep research mode', icon: 'R&D' },
  ];

  // Speech-to-text state
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const sendTextRef = useRef<(content?: string) => void>(() => {});
  const [voiceConfirmation, setVoiceConfirmation] = useState<string | null>(null);
  const voiceConfirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashVoiceConfirmation = useCallback((text: string) => {
    setVoiceConfirmation(`Voice command: ${text}`);
    if (voiceConfirmationTimerRef.current) {
      clearTimeout(voiceConfirmationTimerRef.current);
    }
    voiceConfirmationTimerRef.current = setTimeout(() => {
      setVoiceConfirmation(null);
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (voiceConfirmationTimerRef.current) {
        clearTimeout(voiceConfirmationTimerRef.current);
      }
    };
  }, []);

  const toggleSpeechToText = useCallback(() => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Speech recognition not supported in this browser');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    let finalTranscript = input;
    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setInput(finalTranscript + interim);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => {
      setIsListening(false);
      const finalText = finalTranscript.trim();
      if (!finalText) return;
      if (onVoiceIntent?.(finalText, 'voice')) {
        flashVoiceConfirmation(finalText);
        setInput('');
        return;
      }
      sendTextRef.current(finalText);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [flashVoiceConfirmation, input, isListening, onVoiceIntent, setInput]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const objectUrlMapRef = useRef<Map<string, string>>(new Map());

  // Show slash commands when input starts with "/"
  useEffect(() => {
    if (input === "/" || (input.startsWith("/") && !input.includes(" "))) {
      setShowSlashCommands(true);
      setSelectedCommandIndex(0);
    } else {
      setShowSlashCommands(false);
    }
  }, [input]);

  // Handle slash command selection
  const handleSelectSlashCommand = useCallback((command: SlashCommand) => {
    const placeholder = '"query"';
    const placeholderIndex = command.example.indexOf(placeholder);
    const nextValue =
      placeholderIndex >= 0 ? command.example.replace(placeholder, '""') : command.example;

    setInput(nextValue);
    setShowSlashCommands(false);
    // Focus and position cursor inside the placeholder quotes (if present)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const cursorPos = placeholderIndex >= 0 ? placeholderIndex + 1 : nextValue.length;
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    }, 0);
  }, [setInput]);

  // Selection context for "Chat with Selection" feature
  const { selection, clearSelection } = useSelection();

  // Prompt enhancement action
  const enhancePromptAction = useAction(api.domains.agents.promptEnhancer.enhancePrompt);

  // Handle prompt enhancement (Ctrl+P)
  const handleEnhance = useCallback(async () => {
    if (!input.trim() || isStreaming || isEnhancing) return;

    setIsEnhancing(true);
    try {
      const attachedFileIds = attachedFiles.map((_, i) => `file-${i}`); // Placeholder IDs
      const result = await enhancePromptAction({
        prompt: input,
        threadId,
        attachedFileIds: attachedFileIds.length > 0 ? attachedFileIds : undefined,
      });

      if (result && result.enhanced) {
        setInput(result.enhanced);
        toast.success('Prompt enhanced with context', {
          description: `Added ${result.injectedContext.memory.length} memory contexts, ${result.injectedContext.suggestedTools.length} tool hints`,
        });
      }
    } catch (error) {
      console.error('Enhancement failed:', error);
      toast.error('Failed to enhance prompt');
    } finally {
      setIsEnhancing(false);
    }
  }, [input, threadId, attachedFiles, isStreaming, isEnhancing, enhancePromptAction, setInput]);

  // Keyboard shortcut for enhancement (Ctrl+P)
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && enableEnhancement) {
        e.preventDefault();
        handleEnhance();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleEnhance, enableEnhancement]);

  // Handle document drag-and-drop
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Detect drag type for visual feedback
    const hasCalendarData = e.dataTransfer.types.includes('application/x-nodebench-calendar-event');
    // Support both MIME types: x-nodebench-document (legacy) and x-document-node (DocumentCard)
    const hasDocumentData = e.dataTransfer.types.includes('application/x-nodebench-document') ||
                            e.dataTransfer.types.includes('application/x-document-node');
    const hasFiles = e.dataTransfer.types.includes('Files');

    if (hasCalendarData) {
      setIsDragOver(true);
      setDragType('calendar');
    } else if (hasDocumentData) {
      setIsDragOver(true);
      setDragType('document');
    } else if (hasFiles) {
      setIsDragOver(true);
      setDragType('file');
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragType(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragType(null);

    // Handle document drops - support both MIME types
    // x-nodebench-document (legacy) and x-document-node (DocumentCard)
    let documentData = e.dataTransfer.getData('application/x-nodebench-document');
    if (!documentData) {
      documentData = e.dataTransfer.getData('application/x-document-node');
    }
    if (documentData && onAddContextDocument) {
      try {
        const rawDoc = JSON.parse(documentData);
        // Normalize the document data structure (x-document-node uses 'id', x-nodebench-document uses 'id')
        const doc: DocumentContextItem = {
          id: rawDoc.id || rawDoc._id,
          title: rawDoc.title,
          type: rawDoc.type || 'document',
          analyzing: true,
        };
        onAddContextDocument(doc);
        toast.success(`Added "${doc.title}" to context`);
        // Simulate analysis completion after a delay (would be replaced with actual API call)
        setTimeout(() => {
          onAddContextDocument?.({ ...doc, analyzing: false });
        }, 1500);
      } catch (err) {
        console.error('Failed to parse document data:', err);
      }
    }

    // Handle calendar event drops
    const calendarEventData = e.dataTransfer.getData('application/x-nodebench-calendar-event');
    if (calendarEventData && onAddCalendarEvent) {
      try {
        const event = JSON.parse(calendarEventData) as CalendarEventContextItem;
        onAddCalendarEvent(event);
        toast.success(`Added "${event.title}" to context`);
      } catch (err) {
        console.error('Failed to parse calendar event data:', err);
      }
    }

    // Handle file drops
    if (e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const mediaFiles = files.filter(file =>
        file.type.startsWith('image/') ||
        file.type.startsWith('audio/') ||
        file.type.startsWith('video/')
      );

      // Check file sizes
      const oversizedFiles = mediaFiles.filter(file => file.size > MAX_FILE_SIZE_BYTES);
      if (oversizedFiles.length > 0) {
        toast.error(`File too large for context window. Maximum size: ${MAX_FILE_SIZE_MB}MB`, {
          description: oversizedFiles.map(f => f.name).join(', ')
        });
        // Filter out oversized files
        const validFiles = mediaFiles.filter(file => file.size <= MAX_FILE_SIZE_BYTES);
        if (validFiles.length > 0) {
          onAttachFiles(validFiles);
        }
      } else if (mediaFiles.length > 0) {
        onAttachFiles(mediaFiles);
      }
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 200); // Max 200px
    textarea.style.height = `${newHeight}px`;
  }, [input]);

  // Focus on mount
  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  const handleSend = useCallback((content?: string) => {
    const trimmed = (content ?? input).trim();
    const hasSelection = selection !== null;
    const hasCalendarEvents = contextCalendarEvents.length > 0;
    if ((!trimmed && attachedFiles.length === 0 && !hasSelection && !hasCalendarEvents) || isStreaming) return;

    // Voice intent router — intercept UI commands before agent send
    if (trimmed && onVoiceIntent?.(trimmed, 'text')) {
      flashVoiceConfirmation(trimmed);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    // Check for /spawn command
    if (trimmed.toLowerCase().startsWith('/spawn ') && onSpawn) {
      const spawnResult = parseSpawnCommandLocal(trimmed);
      if (spawnResult) {
        onSpawn(spawnResult.query, spawnResult.agents);
        setInput('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        return;
      }
    }

    let contextPrefix = '';

    // Add calendar event context
    if (hasCalendarEvents) {
      const eventsContext = contextCalendarEvents.map(event => {
        const eventDate = new Date(event.startTime);
        const dateStr = eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        const timeStr = event.allDay ? 'All day' : eventDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const endTimeStr = event.endTime ? new Date(event.endTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
        return `- **${event.title}**\n  - Date: ${dateStr}\n  - Time: ${event.allDay ? 'All day' : `${timeStr}${endTimeStr ? ` - ${endTimeStr}` : ''}`}${event.location ? `\n  - Location: ${event.location}` : ''}${event.description ? `\n  - Description: ${event.description}` : ''}`;
      }).join('\n\n');
      contextPrefix += `**Calendar Events for Context:**\n\n${eventsContext}\n\n---\n\n`;
    }

    // Add selection context
    if (hasSelection && selection) {
      const selectionContext = `**Analyzing ${selection.metadata.sourceType} selection from "${selection.metadata.filename}"${selection.metadata.rangeDescription ? ` (${selection.metadata.rangeDescription})` : ''}:**\n\n${selection.content}\n\n---\n\n`;
      contextPrefix += selectionContext;
    }

    // Send with context
    if (contextPrefix) {
      const defaultPrompt = hasCalendarEvents ? 'Please prepare a dossier for these events.' : 'Please analyze this data.';
      const messageWithContext = trimmed ? `${contextPrefix}${trimmed}` : `${contextPrefix}${defaultPrompt}`;
      onSend(messageWithContext);
      if (hasSelection) clearSelection();
    } else {
      onSend(trimmed || undefined);
    }

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [attachedFiles.length, clearSelection, contextCalendarEvents, contextCalendarEvents.length, flashVoiceConfirmation, input, isStreaming, onSend, onSpawn, onVoiceIntent, selection, setInput]);

  sendTextRef.current = handleSend;

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash command navigation
    if (showSlashCommands) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex((prev) =>
          prev < SLASH_COMMANDS.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex((prev) =>
          prev > 0 ? prev - 1 : SLASH_COMMANDS.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        handleSelectSlashCommand(SLASH_COMMANDS[selectedCommandIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashCommands(false);
        return;
      }
    }

    // PromptInputTextarea owns ordinary Enter-to-submit and preserves Shift+Enter.
    // Slash-command keys above prevent default before the primitive sees them.
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    // Check file sizes
    const oversizedFiles = files.filter(file => file.size > MAX_FILE_SIZE_BYTES);
    if (oversizedFiles.length > 0) {
      toast.error(`File too large for context window. Maximum size: ${MAX_FILE_SIZE_MB}MB`, {
        description: oversizedFiles.map(f => f.name).join(', ')
      });
      const validFiles = files.filter(file => file.size <= MAX_FILE_SIZE_BYTES);
      if (validFiles.length > 0) {
        onAttachFiles(validFiles);
      }
    } else {
      onAttachFiles(files);
    }

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

  useEffect(() => {
    const map = objectUrlMapRef.current;
    const keepKeys = new Set<string>();

    for (const file of attachedFiles) {
      if (!file.type.startsWith("image/")) continue;
      const key = fileKey(file);
      keepKeys.add(key);
      if (!map.has(key)) {
        map.set(key, URL.createObjectURL(file));
      }
    }

    for (const [key, url] of map.entries()) {
      if (!keepKeys.has(key)) {
        URL.revokeObjectURL(url);
        map.delete(key);
      }
    }
  }, [attachedFiles]);

  useEffect(() => {
    const map = objectUrlMapRef.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);

  const handleFilesDrop = (files: File[]) => {
    // Filter for media files (images, audio, video)
    const mediaFiles = files.filter(file =>
      file.type.startsWith('image/') ||
      file.type.startsWith('audio/') ||
      file.type.startsWith('video/')
    );

    // Check file sizes
    const oversizedFiles = mediaFiles.filter(file => file.size > MAX_FILE_SIZE_BYTES);
    if (oversizedFiles.length > 0) {
      toast.error(`File too large for context window. Maximum size: ${MAX_FILE_SIZE_MB}MB`, {
        description: oversizedFiles.map(f => f.name).join(', ')
      });
      const validFiles = mediaFiles.filter(file => file.size <= MAX_FILE_SIZE_BYTES);
      if (validFiles.length > 0) {
        onAttachFiles(validFiles);
      }
    } else if (mediaFiles.length > 0) {
      onAttachFiles(mediaFiles);
    }
  };

  const startRecording = (mode: 'audio' | 'video') => {
    setRecordingMode(mode);
    setIsRecording(true);
  };

  const handleRecordingComplete = (blob: Blob, type: 'audio' | 'video') => {
    const file = new File(
      [blob],
      `${type}-${Date.now()}.webm`,
      { type: type === 'video' ? 'video/webm' : 'audio/webm' }
    );
    onAttachFiles([file]);
    setIsRecording(false);
    setRecordingMode(null);
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <ImageIcon className="h-3.5 w-3.5" />;
    if (file.type.startsWith('audio/')) return <Mic className="h-3.5 w-3.5" />;
    if (file.type.startsWith('video/')) return <Video className="h-3.5 w-3.5" />;
    return <Paperclip className="h-3.5 w-3.5" />;
  };

  const getFilePreview = (file: File) => {
    if (!file.type.startsWith("image/")) return null;
    return objectUrlMapRef.current.get(fileKey(file)) ?? null;
  };

  const canSend = (input.trim().length > 0 || attachedFiles.length > 0 || contextDocuments.length > 0 || selection !== null || contextCalendarEvents.length > 0) && !isStreaming;
  const estimatedInputTokens = Math.ceil(input.length / 4);
  const selectedModelInfo = MODEL_UI_INFO[selectedModel as ApprovedModel];
  const selectedModelMaxTokens = parseContextWindow(selectedModelInfo?.contextWindow);
  const hasContextPills =
    (selectedDocumentIds?.size ?? 0) > 0 ||
    contextDocuments.length > 0 ||
    selection !== null ||
    contextCalendarEvents.length > 0;
  const showTopContextRow = !compact || hasContextPills;

  // Get drag feedback colors based on type
  const getDragFeedbackClasses = () => {
    switch (dragType) {
      case 'calendar':
        return {
          overlay: 'border-purple-500 bg-purple-50/50 dark:bg-purple-900/20',
          text: 'text-purple-600 dark:text-purple-400',
          border: 'border-purple-500 ring-2 ring-purple-500/20',
          message: 'Drop calendar event to add context',
          icon: Calendar,
        };
      case 'document':
        return {
          overlay: 'border-violet-500 bg-violet-50/50 dark:bg-violet-900/20',
          text: 'text-violet-600 dark:text-violet-400',
          border: 'border-violet-500 ring-2 ring-violet-500/20',
          message: 'Drop documents to add context',
          icon: FolderOpen,
        };
      case 'file':
      default:
        return {
          overlay: 'border-violet-500 bg-violet-50/50 dark:bg-violet-900/20',
          text: 'text-violet-600 dark:text-violet-400',
          border: 'border-violet-500 ring-2 ring-violet-500/20',
          message: 'Drop files to add context',
          icon: FolderOpen,
        };
    }
  };

  const dragFeedback = getDragFeedbackClasses();
  const DragIcon = dragFeedback.icon;

  return (
    <div
      ref={containerRef}
      className="relative w-full fa-input-bar-wrapper"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-over visual feedback */}
      {isDragOver && (
        <div className={cn(
          "absolute inset-0 z-10 rounded-lg border-2 border-dashed flex items-center justify-center pointer-events-none",
          dragFeedback.overlay
        )}>
          <div className={cn("flex items-center gap-2", dragFeedback.text)}>
            <DragIcon className="w-5 h-5" />
            <span className="text-sm font-medium">{dragFeedback.message}</span>
          </div>
        </div>
      )}

      {/* File drop overlay */}
      <FileDropOverlay
        containerRef={containerRef}
        onFilesDrop={handleFilesDrop}
        disabled={isStreaming || isRecording}
        hint="Drop media files here"
      />

      {/* Recording Modal */}
      {isRecording && recordingMode && (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/40">
          <MediaRecorderComponent
            mode={recordingMode}
            onRecordingComplete={handleRecordingComplete}
            onClose={() => {
              setIsRecording(false);
              setRecordingMode(null);
            }}
          />
        </div>
      )}

      {/* Main Input Card */}
      <div className={cn(
        "overflow-hidden rounded-[24px] border border-gray-200 bg-white shadow-[0_18px_60px_-42px_rgba(15,23,42,0.28)] transition-all duration-200 dark:border-white/[0.1] dark:bg-[#171b20] dark:shadow-[0_24px_80px_-56px_rgba(0,0,0,0.78)]",
        "focus-within:border-[var(--accent-primary)] focus-within:ring-2 focus-within:ring-[var(--accent-primary)]/15",
        isDragOver && dragFeedback.border
      )}>
        <PromptInput
          className="[&_[data-slot=input-group]]:!h-auto [&_[data-slot=input-group]]:!flex-col [&_[data-slot=input-group]]:!items-stretch [&_[data-slot=input-group]]:!rounded-none [&_[data-slot=input-group]]:!border-0 [&_[data-slot=input-group]]:!bg-transparent [&_[data-slot=input-group]]:!shadow-none [&_[data-slot=input-group]]:focus-within:!ring-0"
          data-testid="fast-agent-prompt-input"
          disableFileHandling
          id={_id}
          onSubmit={({ text }) => handleSend(text)}
        >
        {/* Context Pills Area (Documents, Models, etc.) */}
        {showTopContextRow && (
          <PromptInputHeader className={cn("!px-3 !pt-3 !pb-0 flex-wrap gap-2", compact && "!pt-2.5")}>
            {/* Model Selector */}
            {!compact && (
              <ModelSelector
                modal={false}
                onOpenChange={setShowModelSelector}
                open={showModelSelector}
              >
                <ModelSelectorTrigger asChild>
                  <button
                    aria-label={`Model: ${selectedModelInfo?.name ?? 'Gemini 3 Flash'}`}
                    className="flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-xs transition-all duration-200 hover:border-edge hover:bg-surface-secondary"
                    type="button"
                  >
                    <span className="flex items-center gap-1.5 font-medium text-content-secondary">
                      {selectedModelInfo?.isFree && <Gift className="w-3 h-3 text-violet-500" />}
                      {selectedModelInfo?.name ?? 'Gemini 3 Flash'}
                    </span>
                    <ChevronUp className={cn("w-3 h-3 text-content-muted transition-transform duration-200", showModelSelector && "rotate-180")} />
                  </button>
                </ModelSelectorTrigger>
                <ModelSelectorContent
                  className="z-[1101] max-h-[min(32rem,80vh)] max-w-md overflow-hidden border border-edge bg-surface text-content shadow-2xl"
                  title="Select model"
                >
                  <ModelSelectorInput placeholder="Search approved models..." />
                  <ModelSelectorList className="max-h-[min(24rem,65vh)]">
                    <ModelSelectorEmpty>No approved model found.</ModelSelectorEmpty>
                    <ModelSelectorGroup heading="Approved models">
                      {APPROVED_MODEL_LIST.map((model) => (
                        <ModelSelectorItem
                          className={cn(
                            "items-start gap-2.5 px-3 py-2.5",
                            selectedModel === model.id && "bg-surface-secondary",
                          )}
                          key={model.id}
                          onSelect={() => {
                            onSelectModel(model.id);
                            setShowModelSelector(false);
                          }}
                          value={`${model.name} ${model.id} ${model.description}`}
                        >
                          <ModelSelectorLogo provider={model.provider} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-xs">
                              {model.isFree && <Gift className="w-3 h-3 text-violet-500" />}
                              <ModelSelectorName className={cn(selectedModel === model.id ? "font-semibold text-content" : "font-medium text-content-secondary")}>
                                {model.name}
                              </ModelSelectorName>
                              <span className="text-xs font-medium text-content-muted">{model.contextWindow}</span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-content-muted">{model.description}</p>
                          </div>
                        </ModelSelectorItem>
                      ))}
                    </ModelSelectorGroup>
                  </ModelSelectorList>
                </ModelSelectorContent>
              </ModelSelector>
            )}

          {/* Document Pills (legacy) */}
           {selectedDocumentIds && selectedDocumentIds.size > 0 && Array.from(selectedDocumentIds).map((docId) => (
             <div key={docId} className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-white/[0.12] dark:bg-[#171c22] dark:text-gray-300">
               <FileText className="w-3 h-3" />
               <span className="max-w-[100px] truncate">Document</span>
              <span className="text-gray-400 dark:text-gray-500" aria-hidden="true">
                <X className="w-3 h-3" />
              </span>
             </div>
           ))}

          {/* Context Documents Pills (drag-and-drop) */}
          {contextDocuments.map((doc) => (
            <div
              key={doc.id}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all",
                doc.analyzing
                  ? "border border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/8 text-[var(--accent-primary)] dark:border-[var(--accent-primary)]/25 dark:bg-[var(--accent-primary)]/12"
                  : "border border-gray-200 bg-white text-gray-600 dark:border-white/[0.12] dark:bg-[#171c22] dark:text-gray-300"
              )}
            >
              {doc.analyzing ? (
                <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
              ) : (
                <FileText className="w-3 h-3" />
              )}
              <span className="max-w-[120px] truncate">
                {doc.analyzing ? `Analyzing ${doc.title}...` : doc.title}
              </span>
              {!doc.analyzing && onRemoveContextDocument && (
                <button
                  type="button"
                  onClick={() => onRemoveContextDocument(doc.id)}
                  className="hover:text-content"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}

          {/* Selection Context Pill */}
          {selection && (
            <div className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-white/[0.12] dark:bg-[#171c22] dark:text-gray-300">
              <Table2 className="w-3 h-3" />
              <span className="max-w-[150px] truncate">
                {selection.metadata.sourceType === 'spreadsheet'
                  ? `Cells ${selection.metadata.rangeDescription} from ${selection.metadata.filename}`
                  : `Selection from ${selection.metadata.filename}`
                }
              </span>
              <button
                type="button"
                onClick={clearSelection}
                className="hover:text-content"
                title="Remove selection context"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Calendar Event Context Pills */}
          {contextCalendarEvents.map((event) => {
            const eventDate = new Date(event.startTime);
            const dateStr = eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const timeStr = event.allDay ? 'All day' : eventDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            return (
              <div
                key={event.id}
                className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-white/[0.12] dark:bg-[#171c22] dark:text-gray-300"
              >
                <Calendar className="w-3 h-3" />
                <span className="max-w-[120px] truncate" title={`${event.title} - ${dateStr} ${timeStr}`}>
                  {event.title}
                </span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">
                  {dateStr}
                </span>
                {onRemoveCalendarEvent && (
                  <button
                    type="button"
                    onClick={() => onRemoveCalendarEvent(event.id)}
                    className="hover:text-content"
                    title="Remove event context"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          </PromptInputHeader>
        )}

        {/* Attached Files Preview */}
        {attachedFiles.length > 0 && (
          <div className="px-3 pt-2 flex flex-wrap gap-2">
            {attachedFiles.map((file, index) => {
              const preview = getFilePreview(file);
              return (
                <div key={index} className="relative group flex items-center gap-2 px-2 py-1.5 bg-surface-secondary border border-edge rounded-lg text-xs">
                  {preview ? (
                    <img src={preview} alt={file.name} className="w-6 h-6 object-cover rounded" width={24} height={24} />
                  ) : (
                    <div className="p-1 bg-surface rounded border border-edge">
                      {getFileIcon(file)}
                    </div>
                  )}
                  <span className="max-w-[100px] truncate text-content">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveFile(index)}
                    className="absolute -top-1.5 -right-1.5 bg-surface rounded-full border border-edge p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:text-red-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Slash Command Autocomplete Dropdown */}
        {showSlashCommands && (
          <div className="absolute bottom-full left-0 right-0 mb-2 mx-3 bg-surface rounded-lg border border-edge shadow-xl overflow-hidden z-50 dropdown-enter" style={{ '--dropdown-origin': 'bottom center' } as React.CSSProperties}>
            <div className="px-3 py-2 border-b border-edge/50 bg-surface-secondary">
              <span className="text-xs font-medium text-content-muted">
                Slash Commands
              </span>
            </div>
            <div className="max-h-[240px] overflow-y-auto">
              {SLASH_COMMANDS.map((cmd, index) => (
                <button
                  key={`${cmd.command}-${index}`}
                  type="button"
                  onClick={() => handleSelectSlashCommand(cmd)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover-lift",
                    index === selectedCommandIndex
                      ? "bg-indigo-600/10 text-content"
                      : "hover:bg-surface-secondary text-content-secondary"
                  )}
                >
                  <span className="flex-shrink-0 text-content-muted">{cmd.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{cmd.label}</span>
                      <code className="text-xs px-1.5 py-0.5 bg-surface-secondary rounded text-content-muted">
                        {cmd.command}
                      </code>
                    </div>
                    <p className="text-xs text-content-muted truncate">
                      {cmd.description}
                    </p>
                  </div>
                  {index === selectedCommandIndex && (
                    <kbd className="text-xs px-1.5 py-0.5 bg-surface-secondary rounded text-content-muted flex-shrink-0">
                      Tab/Enter
                    </kbd>
                  )}
                </button>
              ))}
            </div>
            <div className="px-3 py-2 border-t border-edge/50 bg-surface-secondary">
              <p className="text-xs text-content-muted">
                <kbd className="px-1 py-0.5 bg-surface rounded mr-1">â†‘/â†“</kbd>
                navigate
                <kbd className="px-1 py-0.5 bg-surface rounded ml-2 mr-1">Tab</kbd>
                select
                <kbd className="px-1 py-0.5 bg-surface rounded ml-2 mr-1">Esc</kbd>
                close
              </p>
            </div>
          </div>
        )}

        {voiceConfirmation && (
          <div
            className="mx-3 mb-1 rounded-md border border-[var(--accent-primary)]/20 bg-[var(--accent-primary)]/8 px-2.5 py-1 text-[11px] text-[var(--accent-primary)] dark:border-[var(--accent-primary)]/20 dark:bg-[var(--accent-primary)]/10"
            aria-live="polite"
            role="status"
          >
            {voiceConfirmation}
          </div>
        )}

        {/* Input Area */}
        <PromptInputFooter className={cn("!p-3 !flex-row !items-end !justify-start gap-1.5", compact && "!pt-2.5")}>
          {/* Attachment Button */}
          <PromptInputButton
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            className="p-2 text-content-muted hover:text-content hover:bg-surface-secondary rounded-lg transition-all duration-200"
            title="Attach file"
            aria-label="Attach file"
          >
            <Paperclip className="w-4.5 h-4.5" />
          </PromptInputButton>

          {/* Speech-to-Text / Audio Recording */}
          <PromptInputButton
            type="button"
            onClick={toggleSpeechToText}
            disabled={isStreaming || isRecording}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && isListening && recognitionRef.current) {
                event.preventDefault();
                recognitionRef.current.stop();
                setIsListening(false);
              }
            }}
            className={cn(
              "flex h-[44px] w-[44px] flex-none items-center justify-center rounded-lg transition-all duration-200",
              isListening
                ? "text-red-500 bg-red-50 dark:bg-red-900/20 motion-safe:animate-pulse"
                : "text-content-muted hover:text-content hover:bg-surface-secondary"
            )}
            title={isListening ? "Stop listening" : "Voice input (browser speech-to-text)"}
            aria-label={isListening ? "Stop listening" : "Voice input using speech recognition"}
          >
            <Mic className="w-4.5 h-4.5" />
          </PromptInputButton>
          {!compact && (
            <PromptInputButton
              type="button"
              onClick={() => startRecording("video")}
              disabled={isStreaming || isRecording}
              className="p-2 text-content-muted hover:text-content hover:bg-surface-secondary rounded-lg transition-all duration-200"
              title="Record video"
              aria-label="Record video"
            >
              <Video className="w-4.5 h-4.5" />
            </PromptInputButton>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,audio/*,video/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {/* Textarea */}
          <PromptInputBody>
            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Detect @mentions
                const val = e.target.value;
                const cursorPos = e.target.selectionStart || 0;
                const textBefore = val.slice(0, cursorPos);
                const atMatch = textBefore.match(/@(\w*)$/);
                if (atMatch) {
                  setShowMentions(true);
                  setMentionQuery(atMatch[1]);
                } else {
                  setShowMentions(false);
                }
              }}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                // Image paste handling
                const items = e.clipboardData?.items;
                if (items) {
                  const imageFiles: File[] = [];
                  for (const item of Array.from(items)) {
                    if (item.type.startsWith('image/')) {
                      const file = item.getAsFile();
                      if (file) imageFiles.push(file);
                    }
                  }
                  if (imageFiles.length > 0) {
                    e.preventDefault();
                    onAttachFiles([...attachedFiles, ...imageFiles]);
                    toast.success(`Pasted ${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''}`);
                    return;
                  }
                }
                // Smart URL paste: detect URLs and show toast notification
                const pastedText = e.clipboardData?.getData('text') || '';
                const urlMatch = pastedText.match(/^https?:\/\/[^\s]+$/);
                if (urlMatch) {
                  try {
                    const url = new URL(pastedText.trim());
                    const domain = url.hostname.replace('www.', '');
                    toast.info(`URL detected: ${domain}`, { duration: 2000 });
                  } catch { /* not a valid URL */ }
                }
              }}
              placeholder={placeholder}
              disabled={isStreaming}
              maxLength={maxLength}
              className="flex-1 !min-h-0 max-h-[200px] !py-2 bg-transparent border-none focus:ring-0 !px-0 text-sm text-content placeholder:text-content-muted resize-none leading-relaxed"
              rows={1}
            />
          </PromptInputBody>

          {/* @Mentions Autocomplete Popup */}
          {showMentions && (
            <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-surface border border-edge rounded-lg shadow-xl overflow-hidden">
              {MENTION_OPTIONS
                .filter(m => !mentionQuery || m.label.toLowerCase().includes(mentionQuery.toLowerCase()))
                .map((mention, i) => (
                  <button
                    key={mention.label}
                    type="button"
                    onClick={() => {
                      const cursorPos = textareaRef.current?.selectionStart || input.length;
                      const textBefore = input.slice(0, cursorPos);
                      const textAfter = input.slice(cursorPos);
                      const atIdx = textBefore.lastIndexOf('@');
                      const newText = textBefore.slice(0, atIdx) + mention.label + ' ' + textAfter;
                      setInput(newText);
                      setShowMentions(false);
                      textareaRef.current?.focus();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-secondary text-left transition-colors"
                  >
                    <span className="text-sm">{mention.icon}</span>
                    <span className="font-medium text-content">{mention.label}</span>
                    <span className="text-content-muted ml-auto">{mention.description}</span>
                  </button>
                ))}
            </div>
          )}

          {/* Typing Speed Indicator */}
          {!compact && input.length > 10 && (() => {
            const words = input.split(/\s+/).filter(Boolean).length;
            return (
              <span className="text-xs tabular-nums text-content-muted whitespace-nowrap px-1">
                {words}w
              </span>
            );
          })()}

          {/* Response Length Toggle */}
          {!compact && onResponseLengthChange && (
            <button
              type="button"
              onClick={() => {
                const cycle = { brief: 'detailed', detailed: 'exhaustive', exhaustive: 'brief' } as const;
                onResponseLengthChange(cycle[responseLength]);
              }}
              className={cn(
                "p-1.5 rounded-lg transition-all text-content-muted hover:text-content hover:bg-surface-secondary",
                responseLength === 'brief' && "text-amber-500",
                responseLength === 'exhaustive' && "text-violet-500"
              )}
              title={`Response length: ${responseLength}`}
            >
              {responseLength === 'brief' ? <AlignLeft className="w-4 h-4" /> : responseLength === 'exhaustive' ? <BookOpen className="w-4 h-4" /> : <AlignJustify className="w-4 h-4" />}
            </button>
          )}

          {/* Enhance Button (Ctrl+P) */}
          {!compact && enableEnhancement && (
            <InlineEnhancer
              value={input}
              onEnhance={handleEnhance}
              isEnhancing={isEnhancing}
              disabled={isStreaming}
            />
          )}

          {/* Input Token Budget Preview */}
          {!compact && input.length > 20 && !isStreaming && (
            <Context
              maxTokens={selectedModelMaxTokens}
              modelId={selectedModel}
              usedTokens={estimatedInputTokens}
            >
              <ContextTrigger>
                <button
                  aria-label={`Prompt context: approximately ${estimatedInputTokens} tokens`}
                  className="whitespace-nowrap rounded px-1 text-[8px] tabular-nums text-content-muted hover:bg-surface-secondary"
                  title={`Your message: ~${estimatedInputTokens} tokens`}
                  type="button"
                >
                  ~{estimatedInputTokens}t
                </button>
              </ContextTrigger>
              <ContextContent align="end" side="top">
                <ContextContentHeader />
              </ContextContent>
            </Context>
          )}

          {/* Send/Stop Button */}
          <PromptInputSubmit
            aria-label={isStreaming ? 'Stop generating' : 'Send message'}
            className={cn(
              "press-scale relative size-auto rounded-lg p-2.5 transition-all duration-200",
              isStreaming
                ? "group bg-red-500 text-white shadow-md shadow-red-500/20 hover:bg-red-600"
                : canSend
                  ? "bg-[var(--accent-primary)] text-white shadow-sm hover:bg-[var(--accent-primary-hover)]"
                  : "cursor-not-allowed bg-surface-secondary text-content-muted",
            )}
            disabled={!isStreaming && !canSend}
            onStop={onStop}
            status={isStreaming ? 'streaming' : 'ready'}
            title={isStreaming ? 'Stop generating' : 'Send message'}
          >
            {isStreaming ? (
              <>
              <div className="absolute inset-0 rounded-lg bg-red-400 motion-safe:animate-ping opacity-20" />
              <StopCircle className="w-5 h-5 relative z-10" />
              </>
            ) : (
              <Send className="w-5 h-5" />
            )}
          </PromptInputSubmit>
        </PromptInputFooter>
        </PromptInput>
      </div>

      {/* Keyboard shortcut hints */}
      {!compact && (
        <div className="flex items-center gap-3 mt-1 px-1 text-[8px] text-content-muted opacity-40">
          <span className="flex items-center gap-1"><span className="kbd-hint">Enter</span> send</span>
          <span className="flex items-center gap-1"><span className="kbd-hint">Shift+Enter</span> newline</span>
          <span className="flex items-center gap-1"><span className="kbd-hint">/</span> commands</span>
        </div>
      )}

      {/* Character count only when near limit */}
      {input.length > maxLength * 0.8 && (
        <div className="mt-1 px-2 text-xs text-content-muted text-right">
          {input.length} / {maxLength}
        </div>
      )}
    </div>
  );
}
