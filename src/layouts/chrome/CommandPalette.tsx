import { useCallback, useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ai-ui/dialog";
import {
    Command as CommandPrimitive,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut,
} from "@/components/ai-ui/command";
import { useQuery} from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import {
    Search,
    Bell,
    FileText,
    FileSearch,
    Settings,
    Home,
    MessageSquare,
    Command,
    ArrowRight,
    User,
} from 'lucide-react';
import { sanitizeDocumentTitle } from "@/lib/displayText";
import { rankCommandPaletteCommands } from "./commandPaletteUtils";
import { buildCockpitPath, type CockpitSurfaceId } from "@/lib/registry/viewRegistry";
import { getRecentSearches } from "@/features/product/lib/productSession";

export interface CommandAction {
    id: string;
    label: string;
    description?: string;
    icon: ReactNode;
    keywords: string[];
    section: 'navigation' | 'create' | 'search' | 'ai' | 'recent' | 'settings' | 'mode';
    shortcut?: string;
    action: () => void;
}

export interface ExecutedCommand {
    id: string;
    label: string;
    section: CommandAction['section'];
}

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings?: () => void;
    onCommandExecuted?: (command: ExecutedCommand) => void;
    /** Extra actions injected by the host (e.g. cockpit mode switches) */
    additionalActions?: CommandAction[];
}

export function CommandPalette({
    isOpen,
    onClose,
    onOpenSettings,
    onCommandExecuted,
    additionalActions,
}: CommandPaletteProps) {
    const api = useConvexApi();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const deferredQuery = useDeferredValue(query);
    const inputRef = useRef<HTMLInputElement>(null);
    const navigateToSurface = useCallback((surfaceId: CockpitSurfaceId) => {
        navigate(buildCockpitPath({ surfaceId }));
        onClose();
    }, [navigate, onClose]);

    const recentDocs = useQuery(
        api?.domains.documents.documents.getSidebar
            ? api.domains.documents.documents.getSidebar
            : "skip",
        api?.domains.documents.documents.getSidebar ? {} : "skip",
    );

    // Define all available commands
    const allCommands = useMemo<CommandAction[]>(() => {
        const commands: CommandAction[] = [
            // Quick Search — top action so Cmd+K → Enter immediately focuses search
            {
                id: 'quick-search',
                label: 'Search',
                description: 'Search any company, market, or question',
                icon: <Search className="w-4 h-4" />,
                keywords: ['search', 'ask', 'query', 'find', 'company'],
                section: 'navigation',
                shortcut: '/',
                action: () => {
                    navigate(buildCockpitPath({
                        surfaceId: 'ask',
                        extra: { focus: 'home-composer' },
                    }));
                    onClose();
                }
            },
            // Navigation
            {
                id: 'nav-home',
                label: 'Go to Home',
                description: 'Start with a question, upload, or quick preview',
                icon: <Home className="w-4 h-4" />,
                keywords: ['home', 'start', 'ask', 'upload', 'main'],
                section: 'navigation',
                action: () => {
                    navigateToSurface('ask');
                }
            },
            {
                id: 'nav-chat',
                label: 'Go to Chat',
                description: 'Watch the agent work and continue a live session',
                icon: <MessageSquare className="w-4 h-4" />,
                keywords: ['chat', 'session', 'live', 'agent', 'tools'],
                section: 'navigation',
                action: () => {
                    navigateToSurface('workspace');
                }
            },
            {
                id: 'nav-reports',
                label: 'Go to Reports',
                description: 'Open saved reports, exports, and reusable outputs',
                icon: <FileText className="w-4 h-4" />,
                keywords: ['reports', 'saved', 'exports', 'history', 'packets'],
                section: 'navigation',
                action: () => {
                    navigateToSurface('packets');
                }
            },
            {
                id: 'nav-inbox',
                label: 'Go to Inbox',
                description: 'Review approvals, updates, and follow-ups',
                icon: <Bell className="w-4 h-4" />,
                keywords: ['inbox', 'changes', 'reminders', 'follow-up', 'alerts', 'nudges'],
                section: 'navigation',
                action: () => {
                    navigateToSurface('history');
                }
            },
            {
                id: 'nav-me',
                label: 'Go to Me',
                description: 'Manage your files, profile, and connected context',
                icon: <User className="w-4 h-4" />,
                keywords: ['me', 'profile', 'files', 'settings', 'context'],
                section: 'navigation',
                action: () => {
                    navigateToSurface('connect');
                }
            },

            // Settings
            {
                id: 'settings-open',
                label: 'Open Settings',
                description: 'Configure your preferences',
                icon: <Settings className="w-4 h-4" />,
                keywords: ['settings', 'preferences', 'config', 'options'],
                section: 'settings',
                shortcut: 'Ctrl+,',
                action: () => {
                    onOpenSettings?.();
                    onClose();
                }
            },
        ];

        // Add recent documents
        if (recentDocs && recentDocs.length > 0) {
            recentDocs.forEach((doc: any) => {
                commands.push({
                    id: `doc-${doc._id}`,
                    label: sanitizeDocumentTitle(doc.title, 'Untitled Document'),
                    description: `Open recent document`,
                    icon: <FileText className="w-4 h-4" />,
                    keywords: ['recent', 'document', sanitizeDocumentTitle(doc.title, 'Untitled Document').toLowerCase()],
                    section: 'recent',
                    action: () => {
                        window.dispatchEvent(
                            new CustomEvent('nodebench:openDocument', {
                                detail: { documentId: doc._id },
                            }),
                        );
                        onClose();
                    }
                });
            });
        }

        // Add recent searches from localStorage
        const recentSearches = getRecentSearches();
        recentSearches.forEach((search) => {
            commands.push({
                id: `recent-search-${search.query}`,
                label: search.query,
                description: `${search.lens} lens`,
                icon: <Search className="w-4 h-4" />,
                keywords: ['recent', 'search', search.query.toLowerCase()],
                section: 'recent',
                action: () => {
                    navigate(`/?surface=chat&q=${encodeURIComponent(search.query)}&lens=${encodeURIComponent(search.lens)}`);
                    onClose();
                }
            });
        });

        return [...(additionalActions ?? []), ...commands];
    }, [additionalActions, navigate, recentDocs, navigateToSurface, onOpenSettings, onClose]);

    // Lightweight fuzzy scorer: returns 0 (no match) or positive score (higher = better)
    const fuzzyScore = useCallback((text: string, term: string): number => {
        const t = text.toLowerCase();
        const q = term.toLowerCase();
        // Exact prefix match = highest
        if (t.startsWith(q)) return 100;
        // Contains substring = high
        if (t.includes(q)) return 60;
        // Fuzzy: all query chars appear in order
        let ti = 0;
        let consecutive = 0;
        let maxConsecutive = 0;
        for (let qi = 0; qi < q.length; qi++) {
            const found = t.indexOf(q[qi], ti);
            if (found === -1) return 0;
            if (found === ti) { consecutive++; maxConsecutive = Math.max(maxConsecutive, consecutive); }
            else { consecutive = 1; }
            ti = found + 1;
        }
        return 10 + maxConsecutive * 5;
    }, []);

    // Filter and rank commands with fuzzy search (deferred so typing stays responsive)
    const filteredCommands = useMemo(() => {
        if (!deferredQuery.trim()) {
            return rankCommandPaletteCommands(allCommands.filter(cmd =>
                cmd.section === 'mode' ||
                cmd.section === 'navigation' ||
                cmd.section === 'create' ||
                cmd.section === 'recent'
            ), deferredQuery);
        }

        const searchTerm = deferredQuery.trim();
        const scored = allCommands
            .map(cmd => {
                const labelScore = fuzzyScore(cmd.label, searchTerm);
                const descScore = cmd.description ? fuzzyScore(cmd.description, searchTerm) * 0.6 : 0;
                const kwScore = Math.max(0, ...cmd.keywords.map(kw => fuzzyScore(kw, searchTerm) * 0.8));
                const best = Math.max(labelScore, descScore, kwScore);
                return { cmd, score: best };
            })
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score);

        return scored.map(({ cmd }) => cmd);
    }, [deferredQuery, allCommands, fuzzyScore]);

    // Group commands by section
    const groupedCommands = useMemo(() => {
        const groups: Record<string, CommandAction[]> = {};

        filteredCommands.forEach(cmd => {
            if (!groups[cmd.section]) {
                groups[cmd.section] = [];
            }
            groups[cmd.section].push(cmd);
        });

        return groups;
    }, [filteredCommands]);

    const executeCommand = useCallback((command: CommandAction) => {
        onCommandExecuted?.({
            id: command.id,
            label: command.label,
            section: command.section,
        });
        command.action();
    }, [onCommandExecuted]);

    const sectionLabels: Record<string, string> = {
        mode: 'Switch Mode',
        navigation: 'Navigate',
        create: 'Create New',
        search: 'Search Results',
        ai: 'AI Actions',
        recent: 'Recent',
        settings: 'Settings'
    };

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
          <DialogContent
            className="top-[15vh] w-[calc(100%-2rem)] max-w-2xl translate-y-0 gap-0 overflow-hidden border-edge bg-surface p-0 shadow-2xl dark:shadow-black/40"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
                event.preventDefault();
                setQuery('');
                requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            <DialogTitle className="sr-only">Command palette</DialogTitle>
            <CommandPrimitive shouldFilter={false} label="Search commands" className="bg-transparent text-content">
            {/* Palette Header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <div className="flex items-center gap-2">
                    <Command className="w-4 h-4 text-content-muted" />
                    <span className="text-xs font-semibold text-content-secondary">Command Palette</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-content-muted">
                    <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded text-xs font-mono">ESC</kbd>
                    <span>to close</span>
                </div>
            </div>

            {/* Search Input */}
            <div className="border-b border-edge">
                <CommandInput
                    id="command-palette-input"
                    ref={inputRef}
                    value={query}
                    onValueChange={setQuery}
                    placeholder="Search commands or navigate…"
                    className="text-content placeholder:text-content-muted dark:placeholder-gray-500"
                    aria-label="Search commands"
                    data-agent-id="cmd:search"
                    data-agent-action="search"
                    data-agent-label="Search commands"
                />
            </div>

            {/* Commands List */}
            <CommandList
                accessibleLabel="Commands"
                className="max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent"
            >
                {filteredCommands.length === 0 ? (
                    <CommandEmpty className="py-12 text-center text-content-muted text-sm">
                        <FileSearch className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No commands found</p>
                        <p className="text-xs mt-1">Try a different search term</p>
                    </CommandEmpty>
                ) : (
                    Object.entries(groupedCommands).map(([section, commands]) => (
                        <CommandGroup
                            key={section}
                            heading={sectionLabels[section] || section}
                            className="py-2 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-content-secondary"
                        >
                            {commands.map((cmd) => {
                                return (
                                    <CommandItem
                                        key={cmd.id}
                                        value={cmd.id}
                                        keywords={[cmd.label, cmd.description ?? "", ...cmd.keywords]}
                                        data-agent-id={`cmd:${cmd.id}`}
                                        data-agent-action="navigate"
                                        data-agent-label={cmd.label}
                                        onSelect={() => executeCommand(cmd)}
                                        className="group w-full cursor-pointer gap-3 rounded-none border-l-2 border-l-transparent px-4 py-2.5 text-left text-content-secondary transition-colors hover:bg-surface-hover data-[selected=true]:border-l-[rgb(79,70,229)] data-[selected=true]:bg-surface-secondary data-[selected=true]:text-content"
                                    >
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-secondary text-content-muted group-data-[selected=true]:bg-surface group-data-[selected=true]:text-content">
                                            {cmd.icon}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm truncate">{cmd.label}</div>
                                            {cmd.description && (
                                                <div className="text-xs text-content-secondary truncate">{cmd.description}</div>
                                            )}
                                        </div>
                                        {cmd.shortcut ? (
                                            <CommandShortcut className="hidden rounded bg-surface-secondary px-2 py-1 font-mono text-content-secondary sm:block">
                                                {cmd.shortcut}
                                            </CommandShortcut>
                                        ) : <ArrowRight className="hidden h-4 w-4 text-content-muted group-data-[selected=true]:block" />}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    ))
                )}
            </CommandList>

            {/* Footer Hints */}
            <div className="px-4 py-2 border-t border-edge bg-surface-secondary flex items-center justify-between text-xs text-content-secondary">
                <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 bg-surface rounded text-xs font-mono border border-edge dark:text-content-muted">↑↓</kbd>
                        Navigate
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 bg-surface rounded text-xs font-mono border border-edge dark:text-content-muted">↵</kbd>
                        Select
                    </span>
                </div>
                <span className="flex items-center gap-1">
                    <Command className="w-3 h-3" />
                    <span>Command Palette</span>
                </span>
            </div>
            </CommandPrimitive>
          </DialogContent>
        </Dialog>
    );
}
