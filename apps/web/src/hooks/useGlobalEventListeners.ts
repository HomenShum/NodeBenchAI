import { useEffect } from 'react';
import { Id } from '@convex/_generated/dataModel';
import type { MainView } from '@/lib/registry/viewRegistry';

interface UseGlobalEventListenersOptions {
    // Agent Panel
    setShowFastAgent: (show: boolean) => void;
    setFastAgentThreadId: (id: string | null) => void;
    setSelectedDocumentIdsForAgent: (ids: Id<"documents">[]) => void;

    // Navigation / Views
    setCurrentView: (view: MainView) => void;
    navigateToView?: (view: MainView) => void;
    onDocumentSelect: (documentId: Id<"documents"> | null) => void;
    setIsGridMode: (isGrid: boolean) => void;
    setIsTransitioning: (isTransitioning: boolean) => void;

    // Popovers
    setMentionPopover: (state: { documentId: Id<"documents">; anchorEl: HTMLElement } | null) => void;
    setHashtagPopover: (state: { dossierId: Id<"documents">; hashtag: string; anchorEl: HTMLElement } | null) => void;

    // Settings
    openSettings: (tab: "usage") => void;
}

/**
 * Hook to manage global window event listeners.
 * Extracts ~150 lines of event handling logic from MainLayout.
 */
export function useGlobalEventListeners(options: UseGlobalEventListenersOptions) {
    const {
        setShowFastAgent,
        setFastAgentThreadId,
        setSelectedDocumentIdsForAgent,
        setCurrentView,
        navigateToView,
        onDocumentSelect,
        setIsGridMode,
        setIsTransitioning,
        setMentionPopover,
        setHashtagPopover,
        openSettings,
    } = options;

    const goToView = (view: MainView) => {
        if (navigateToView) navigateToView(view);
        else setCurrentView(view);
    };

    // Fast Agent Thread Navigation
    useEffect(() => {
        const handler = (e: CustomEvent<{ threadId: string }>) => {
            setFastAgentThreadId(e.detail.threadId);
            setShowFastAgent(true);
        };
        window.addEventListener('navigate:fastAgentThread' as any, handler as any);
        return () => window.removeEventListener('navigate:fastAgentThread' as any, handler as any);
    }, [setFastAgentThreadId, setShowFastAgent]);

    // Chat with Document
    useEffect(() => {
        const handler = (e: CustomEvent<{ documentId: Id<"documents">; documentTitle?: string }>) => {
            setSelectedDocumentIdsForAgent([e.detail.documentId]);
            setShowFastAgent(true);
        };
        window.addEventListener('ai:chatWithDocument' as any, handler as any);
        return () => window.removeEventListener('ai:chatWithDocument' as any, handler as any);
    }, [setSelectedDocumentIdsForAgent, setShowFastAgent]);

    // Global Help
    useEffect(() => {
        const onHelp = (_evt: Event) => {
            openSettings("usage");
        };
        window.addEventListener('app:help', onHelp as EventListener);
        return () => {
            window.removeEventListener('app:help', onHelp as EventListener);
        };
    }, [openSettings]);

    // Open Multiple Documents (AI)
    useEffect(() => {
        const handler = (evt: Event) => {
            try {
                const e = evt as CustomEvent<{ documentIds?: Id<"documents">[] }>;
                const maybeIds = e.detail?.documentIds;
                const ids: Id<"documents">[] = Array.isArray(maybeIds) ? maybeIds : [];
                if (ids.length === 0) return;

                goToView('chat-home');
                setIsGridMode(true);

                // Select each document in sequence so the active document surface can hydrate context.
                onDocumentSelect(ids[0]);
                ids.slice(1).forEach((id, idx) => {
                    setTimeout(() => onDocumentSelect(id), (idx + 1) * 50);
                });
                // Reselect the first to keep context predictable
                setTimeout(() => onDocumentSelect(ids[0]), (ids.length + 1) * 50);
            } catch (err) {
                console.warn('Failed to handle ai:openMultipleDocuments event', err);
            }
        };
        window.addEventListener('ai:openMultipleDocuments', handler);
        return () => {
            window.removeEventListener('ai:openMultipleDocuments', handler);
        };
    }, [navigateToView, onDocumentSelect, setIsGridMode, setCurrentView]);

    // Open Single Document (Mentions/Deep Links)
    useEffect(() => {
        const handler = (evt: Event) => {
            try {
                const e = evt as CustomEvent<{ documentId?: string; openInGrid?: boolean; sourceDocumentId?: string }>;
                const rawId = e.detail?.documentId;
                if (!rawId) return;
                const docId = rawId as Id<"documents">;
                const sourceId = e.detail?.sourceDocumentId as Id<"documents"> | undefined;
                const openInGrid = Boolean(e.detail?.openInGrid);

                goToView('chat-home');

                if (openInGrid) {
                    setIsGridMode(true);
                    if (sourceId && sourceId !== docId) {
                        try {
                            window.dispatchEvent(
                                new CustomEvent('grid:pinFirst', { detail: { docId: sourceId } })
                            );
                        } catch (err) {
                            void err;
                        }
                        onDocumentSelect(sourceId);
                        setTimeout(() => onDocumentSelect(docId), 30);
                    } else {
                        onDocumentSelect(docId);
                    }
                } else {
                    onDocumentSelect(docId);
                }
            } catch (err) {
                console.warn('Failed to handle nodebench:openDocument event', err);
            }
        };
        window.addEventListener('nodebench:openDocument', handler as EventListener);
        return () => {
            window.removeEventListener('nodebench:openDocument', handler as EventListener);
        };
    }, [navigateToView, onDocumentSelect, setIsGridMode, setCurrentView]);

    // Mention Popover
    useEffect(() => {
        const handler = (evt: Event) => {
            try {
                const e = evt as CustomEvent<{ documentId?: string }>;
                const documentId = e.detail?.documentId as Id<"documents"> | undefined;

                if (!documentId) return;

                // Find the mention element that triggered the event
                const mentionElements = document.querySelectorAll(`[data-document-id="${documentId}"]`);
                const anchorEl = mentionElements[0] as HTMLElement;

                if (anchorEl) {
                    setMentionPopover({ documentId, anchorEl });
                }
            } catch (err) {
                console.warn('Failed to handle nodebench:showMentionPopover event', err);
            }
        };
        window.addEventListener('nodebench:showMentionPopover', handler as EventListener);
        return () => {
            window.removeEventListener('nodebench:showMentionPopover', handler as EventListener);
        };
    }, [setMentionPopover]);

    // Hashtag Popover
    useEffect(() => {
        const handler = (evt: Event) => {
            try {
                const e = evt as CustomEvent<{ dossierId?: string; hashtag?: string }>;
                const dossierId = e.detail?.dossierId as Id<"documents"> | undefined;
                const hashtag = e.detail?.hashtag;

                if (!dossierId || !hashtag) return;

                const hashtagElements = document.querySelectorAll(`[data-dossier-id="${dossierId}"]`);
                const anchorEl = hashtagElements[0] as HTMLElement;

                if (anchorEl) {
                    setHashtagPopover({ dossierId, hashtag, anchorEl });
                }
            } catch (err) {
                console.warn('Failed to handle nodebench:showHashtagQuickNote event', err);
            }
        };
        window.addEventListener('nodebench:showHashtagQuickNote', handler as EventListener);
        return () => {
            window.removeEventListener('nodebench:showHashtagQuickNote', handler as EventListener);
        };
    }, [setHashtagPopover]);

    // Go Back Navigation
    useEffect(() => {
        const handler = () => {
            setIsTransitioning(true);
            // startTransition is not passed here, we assume direct state updates for simplicity in hook extraction
            // or we could accept startTransition as dependency if strictly needed, but basic callback works.
            // Replicating original logic:
            onDocumentSelect(null);
            setTimeout(() => setIsTransitioning(false), 100);
        };
        window.addEventListener('nodebench:goBack', handler);
        return () => {
            window.removeEventListener('nodebench:goBack', handler);
        };
    }, [setIsTransitioning, onDocumentSelect]);

    // Global Navigation Shortcuts
    useEffect(() => {
        const toCalendar = () => goToView('nudges-home');
        const toTimeline = () => goToView('pulse-home');
        const toDocuments = () => goToView('chat-home');
        const toRoadmap = () => goToView('product-direction');
        const toAgents = () => goToView('agents');

        window.addEventListener('navigate:calendar', toCalendar as unknown as EventListener);
        window.addEventListener('navigate:timeline', toTimeline as unknown as EventListener);
        window.addEventListener('navigate:documents', toDocuments as unknown as EventListener);
        window.addEventListener('navigate:roadmap', toRoadmap as unknown as EventListener);
        window.addEventListener('navigate:agents', toAgents as unknown as EventListener);

        return () => {
            window.removeEventListener('navigate:calendar', toCalendar as unknown as EventListener);
            window.removeEventListener('navigate:timeline', toTimeline as unknown as EventListener);
            window.removeEventListener('navigate:documents', toDocuments as unknown as EventListener);
            window.removeEventListener('navigate:roadmap', toRoadmap as unknown as EventListener);
            window.removeEventListener('navigate:agents', toAgents as unknown as EventListener);
        };
    }, [navigateToView, setCurrentView]);
}
