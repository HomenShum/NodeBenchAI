import { useState, useRef, useEffect } from "react";
import { useAction } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../../convex/_generated/api";
import ReactMarkdown from 'react-markdown';
import {
  Bot,
  Send,
  Loader2,
  FileText,
  Plus,
  BookOpen,
  ArrowRight,
  CheckCircle,
  Sparkles,
  Users,
  Brain,
  Terminal,
  Briefcase,
  Landmark,
  Microscope,
  LineChart,
  Megaphone,
  Stethoscope,
} from "lucide-react";
import { Id } from "../../../../convex/_generated/dataModel";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  completed: boolean;
  action?: string;
}

interface Message {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'tool_code_output';
  content: string;
  timestamp: Date;
  isProcessing?: boolean;
  documentCreated?: {
    id: Id<"documents">;
    title: string;
  };
  data?: any;
}

interface WelcomePageProps {
  onGetStarted: () => void;
  onDocumentSelect: (documentId: Id<"documents">) => void;
}

export function TutorialPage({ onGetStarted, onDocumentSelect }: WelcomePageProps) {
  const { signIn } = useAuthActions();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'system',
      content: "👋 Welcome to your AI-powered document workspace!",
      timestamp: new Date()
    },
    {
      id: '2',
      type: 'assistant',
      content: "Hi there! I'm your AI assistant, and I'm excited to help you get started. I can help you create documents, organize your workspace, and answer any questions you have.\n\nLet's begin with a quick tour. What would you like to learn about first?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [agentThreadId, setAgentThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const askOnboardingAssistant = useAction(api.domains.auth.onboarding.askOnboardingAssistant);

  const extractDocumentFromToolResults = (
    toolResults: any[],
    fallbackText: string,
  ): { id: Id<"documents">; title: string } | null => {
    for (const entry of toolResults) {
      if (typeof entry === 'string') {
        const idMatch = entry.match(/ID:\s*([a-z0-9_-]{8,})/i);
        if (idMatch) {
          const titleMatch = entry.match(/Title:\s*"([^"]+)"|Title:\s*([^\n]+)/i);
          const titleValue = titleMatch?.[1] ?? titleMatch?.[2] ?? 'Created document';
          return {
            id: idMatch[1] as Id<"documents">,
            title: titleValue.replace(/"$/, '').trim(),
          };
        }
      } else if (entry && typeof entry === 'object') {
        const docId = (entry as any).documentId ?? (entry as any).id;
        if (typeof docId === 'string') {
          const titleValue = typeof (entry as any).title === 'string'
            ? (entry as any).title
            : 'Created document';
          return {
            id: docId as Id<"documents">,
            title: titleValue,
          };
        }
      }
    }

    const fallbackId = fallbackText.match(/ID:\s*([a-z0-9_-]{8,})/i);
    if (fallbackId) {
      const fallbackTitle = fallbackText.match(/Title:\s*"([^"]+)"|Title:\s*([^\n]+)/i);
      return {
        id: fallbackId[1] as Id<"documents">,
        title: (fallbackTitle?.[1] ?? fallbackTitle?.[2] ?? 'Created document').trim(),
      };
    }

    return null;
  };

  const [onboardingSteps, setOnboardingSteps] = useState<OnboardingStep[]>([
    {
      id: 'welcome',
      title: 'Welcome to Your Workspace',
      description: 'Get familiar with the AI-powered document management system',
      icon: <Sparkles className="h-5 w-5" />,
      completed: true
    },
    {
      id: 'create-first-doc',
      title: 'Create Your First Document',
      description: 'Learn how to create and structure documents with AI assistance',
      icon: <Plus className="h-5 w-5" />,
      completed: false,
      action: "How do I create my first document?"
    },
    {
      id: 'ai-features',
      title: 'Discover AI Features',
      description: 'Explore how AI can help with content generation and editing',
      icon: <Brain className="h-5 w-5" />,
      completed: false,
      action: "What AI features are available?"
    },
    {
      id: 'organize-workspace',
      title: 'Organize Your Workspace',
      description: 'Learn about document organization and search capabilities',
      icon: <FileText className="h-5 w-5" />,
      completed: false,
      action: "Show me organization tips"
    },
    {
      id: 'collaboration',
      title: 'Collaboration Features',
      description: 'Discover real-time editing and sharing capabilities',
      icon: <Users className="h-5 w-5" />,
      completed: false,
      action: "How does collaboration work?"
    }
  ]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const completeStep = (stepId: string) => {
    setOnboardingSteps(prev => {
      const updatedSteps = prev.map(step =>
        step.id === stepId ? { ...step, completed: true } : step
      );
      const currentIndex = updatedSteps.findIndex(step => step.id === stepId);
      if (currentIndex !== -1 && currentIndex < updatedSteps.length - 1) {
        setCurrentStep(currentIndex + 1);
      }
      return updatedSteps;
    });
  };

  const handleSendMessage = async (contentOverride?: string) => {
    const messageContent = contentOverride || input;
    if (!messageContent.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: messageContent,
      timestamp: new Date(),
    };

    const newMessages: Message[] = [...messages, userMessage];

    setMessages(newMessages);
    if (!contentOverride) {
      setInput('');
    }
    setIsLoading(true);

    const assistantMessageId = (Date.now() + 1).toString();
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isProcessing: true,
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      const result = await askOnboardingAssistant({
        message: messageContent,
        threadId: agentThreadId ?? undefined,
      });

      if (result.threadId) {
        setAgentThreadId(result.threadId);
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: result.response, isProcessing: false }
            : m
        )
      );

      const lowerMessage = messageContent.toLowerCase();
      const lowerResponse = result.response.toLowerCase();

      if (result.toolsCalled.includes('createDocument')) {
        completeStep('create-first-doc');

        const createdDoc = extractDocumentFromToolResults(result.toolResults, result.response);
        if (createdDoc) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId
                ? {
                    ...m,
                    documentCreated: {
                      id: createdDoc.id,
                      title: createdDoc.title,
                    },
                  }
                : m
            )
          );
          onDocumentSelect(createdDoc.id);
        }
      }

      if (
        lowerMessage.includes('ai features') ||
        lowerMessage.includes('what can you do') ||
        lowerResponse.includes('ai features')
      ) {
        completeStep('ai-features');
      }

      if (
        lowerMessage.includes('organization') ||
        lowerMessage.includes('organize') ||
        result.toolsCalled.includes('findDocument') ||
        result.toolsCalled.includes('delegateToDocumentAgent')
      ) {
        completeStep('organize-workspace');
      }

      if (
        lowerMessage.includes('collaboration') ||
        lowerMessage.includes('sharing') ||
        lowerResponse.includes('collaboration')
      ) {
        completeStep('collaboration');
      }

      if (result.error) {
      }
    } catch (error) {
      console.error('Error contacting onboarding assistant:', error);
      const errorMessage = error instanceof Error
        ? `The onboarding assistant hit an error: ${error.message}. You can try again or open the Fast Agent panel from the lightning icon to continue.`
        : 'The onboarding assistant is unavailable right now. Please try again or open the Fast Agent panel from the lightning icon to continue.';

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: errorMessage, isProcessing: false }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = (action: string) => {
    void handleSendMessage(action);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const completedSteps = onboardingSteps.filter(step => step.completed).length;
  const progressPercentage = (completedSteps / onboardingSteps.length) * 100;

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame px-6 py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--accent-primary-bg)] rounded-full mb-4">
            <Bot className="h-8 w-8 text-[var(--accent-primary)]" />
          </div>
          <h1 className="text-4xl font-bold text-content mb-2">
            Welcome to Your AI Workspace
          </h1>
          <p className="text-xl text-content-secondary max-w-2xl mx-auto mb-4">
            Let's get you started with your intelligent document management system.
            I'm here to guide you every step of the way!
          </p>
          <button
            onClick={onGetStarted}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-content-secondary hover:text-content hover:bg-surface rounded-lg transition-all duration-200 border border-edge"
          >
            Skip tutorial and go to workspace
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-content">Onboarding Progress</span>
            <span className="text-sm text-content-secondary">{completedSteps} of {onboardingSteps.length} completed</span>
          </div>
          <div className="w-full bg-surface-secondary rounded-full h-2">
            <div
              className="bg-[var(--accent-primary)] h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
        </div>

        <div className="mb-8 rounded-lg overflow-hidden border border-edge bg-surface">
          <div className="w-full aspect-video">
            <iframe
              className="w-full h-full"
              src="https://www.youtube.com/embed/XRYUUDNh4GQ"
              title="NodeBench AI Demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-surface rounded-lg shadow-sm border border-edge p-6">
              <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-[var(--accent-primary)]" />
                Getting Started Guide
              </h2>
              <div className="space-y-4">
                {onboardingSteps.map((step, index) => (
                  <div
                    key={step.id}
                    className={`p-4 rounded-lg border transition-all cursor-pointer ${
                      step.completed
                        ? 'bg-[var(--accent-primary-bg)] border-edge'
                        : index === currentStep
                        ? 'bg-[var(--accent-primary-bg)] border-[var(--accent-primary)]/30 ring-2 ring-[var(--accent-primary)]/20'
                        : 'bg-surface-secondary border-edge hover:bg-surface-hover'
                    }`}
                    onClick={() => step.action && !step.completed && void handleQuickAction(step.action)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        step.completed
                          ? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]'
                          : 'bg-surface-secondary text-content-secondary'
                      }`}>
                        {step.completed ? <CheckCircle className="h-5 w-5" /> : step.icon}
                      </div>
                      <div>
                        <h4 className="font-semibold text-content">{step.title}</h4>
                        <p className="text-xs text-content-secondary mt-1">{step.description}</p>
                        {step.action && !step.completed && (
                          <div className="mt-2 text-xs text-[var(--accent-primary)] font-semibold flex items-center gap-1">
                            Try it <ArrowRight className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {completedSteps === onboardingSteps.length && (
                  <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2 text-green-800 mb-2">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Congratulations!</span>
                    </div>
                    <p className="text-sm text-green-700 mb-3">
                      You've completed the onboarding! You're ready to start creating amazing documents.
                    </p>
                    <button
                      onClick={onGetStarted}
                      className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors font-medium"
                    >
                      Enter Your Workspace
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-surface rounded-lg shadow-sm border border-edge h-[600px] flex flex-col">
              <div className="p-4 border-b border-edge flex items-center gap-3">
                <div className="w-10 h-10 bg-[var(--accent-primary-bg)] rounded-full flex items-center justify-center">
                  <Bot className="h-5 w-5 text-[var(--accent-primary)]" />
                </div>
                <div>
                  <h3 className="font-medium text-content">AI Onboarding Assistant</h3>
                  <p className="text-sm text-content-secondary">Ask me anything about getting started!</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((message) => {
                  switch (message.type) {
                    case 'user':
                      return (
                        <div key={message.id} className="flex justify-end">
                          <div className="bg-[var(--accent-primary)] text-white rounded-lg px-4 py-2 max-w-lg">
                            <ReactMarkdown>{message.content}</ReactMarkdown>
                          </div>
                        </div>
                      );
                    case 'assistant':
                      return (
                        <div key={message.id} className="flex justify-start">
                          <div className="flex items-start gap-2.5">
                            <div className="bg-surface-secondary text-content rounded-full h-8 w-8 flex items-center justify-center flex-shrink-0">
                              <Bot className="h-5 w-5" />
                            </div>
                            <div className="bg-surface border border-edge rounded-lg px-4 py-2 max-w-lg">
                              <ReactMarkdown
                                components={{
                                  p: ({ node: _node, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                                }}
                              >
                                {message.content}
                              </ReactMarkdown>
                              {message.isProcessing && (
                                <Loader2 className="h-4 w-4 motion-safe:animate-spin my-2" />
                              )}
                              {message.documentCreated && (
                                <div className="mt-2 p-2 bg-[var(--accent-primary-bg)] border border-[var(--accent-primary)]/20 rounded-md flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-[var(--accent-primary)]" />
                                  <span className="text-sm text-content">Document created:</span>
                                  <button
                                    onClick={() => onDocumentSelect(message.documentCreated!.id)}
                                    className="font-semibold text-sm text-[var(--accent-primary)] hover:underline"
                                  >
                                    {message.documentCreated.title}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    case 'system':
                      return (
                        <div key={message.id} className="flex justify-center">
                          <div className="text-center text-xs text-content-secondary p-2 bg-surface-secondary rounded-full">
                            {message.content}
                          </div>
                        </div>
                      );
                    case 'tool_code_output': {
                      const { toolName, output } = message.data || {};
                      return (
                        <div key={message.id} className="my-4 p-3 bg-surface-secondary border border-edge rounded-lg">
                          <div className="font-semibold text-xs text-content-secondary flex items-center gap-2 mb-1">
                            <Terminal className="h-3 w-3" />
                            <span>Tool Output: {toolName || 'Unknown Tool'}</span>
                          </div>
                          <pre className="text-xs bg-gray-900 text-white p-2 rounded-md overflow-x-auto"><code>{output}</code></pre>
                        </div>
                      );
                    }
                    default:
                      return null;
                  }
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-t border-edge">
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    onClick={() => void handleQuickAction("How do I create my first document?")}
                    className="text-xs bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] px-3 py-1 rounded-full hover:bg-surface-hover transition-colors"
                  >
                    Create Document
                  </button>
                  <button
                    onClick={() => void handleQuickAction("What AI features are available?")}
                    className="text-xs bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] px-3 py-1 rounded-full hover:bg-surface-hover transition-colors"
                  >
                    AI Features
                  </button>
                  <button
                    onClick={() => void handleQuickAction("How does collaboration work?")}
                    className="text-xs bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] px-3 py-1 rounded-full hover:bg-surface-hover transition-colors"
                  >
                    Collaboration
                  </button>
                  <button
                    onClick={() => void handleQuickAction("Show me organization tips")}
                    className="text-xs bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] px-3 py-1 rounded-full hover:bg-surface-hover transition-colors"
                  >
                    Organization
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask me anything about getting started..."
                    className="flex-1 px-3 py-2 border border-edge rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 focus:border-transparent"
                    disabled={isLoading}
                  />
                  <button
                    onClick={() => void handleSendMessage()}
                    disabled={!input.trim() || isLoading}
                    className="px-3 py-2 bg-[var(--accent-primary)] text-white rounded-md hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
