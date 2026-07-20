/**
 * DocumentsHub Context
 * 
 * Provides shared state and actions for DocumentsHub views.
 * This context enables extracting view components while maintaining
 * access to shared data and handlers.
 */

import { createContext, useContext, type ReactNode } from "react";
import { Id, Doc } from "../../../../../../convex/_generated/dataModel";
import type { TaskStatus, AgendaMode, DocViewMode, AgendaEntry } from "../types";

// Re-export types for convenience (consumers can also import from types directly)
export type { TaskStatus, AgendaMode, DocViewMode, AgendaEntry };

// ============================================================================
// Context Value Interface
// ============================================================================

export interface DocumentsHubContextValue {
    // User & Auth
    loggedInUser: any | null;
    userId?: Id<"users">;

    // View Mode
    mode: "list" | "kanban" | "weekly";
    setMode: (mode: "list" | "kanban" | "weekly") => void;
    docViewMode: DocViewMode;
    setDocViewMode: (mode: DocViewMode) => void;

    // Agenda Mode
    agendaMode: AgendaMode;
    setAgendaMode: (mode: AgendaMode) => void;

    // Time & Dates
    tzOffsetMinutes: number;
    todayStartUtc: number;
    weekStartUtc: number;
    weekEndUtc: number;
    focusedDateMs: number | null;

    // Week Navigation
    weekRangeLabel: string;
    onPrevWeek: () => void;
    onNextWeek: () => void;
    onTodayWeek: () => void;

    // Tasks Data
    todoTasks: Doc<any>[];
    inProgressTasks: Doc<any>[];
    doneTasks: Doc<any>[];
    blockedTasks: Doc<any>[];
    tasksToday: any[];
    tasksThisWeek: any[];

    // Events Data
    eventsToday: any[];
    eventsThisWeek: any[];

    // Holidays
    holidaysToday: any[];
    holidaysThisWeek: any[];

    // Documents
    documents: any[];
    isDocsLoading: boolean;

    // Task Selection
    selectedTaskId?: Id<"userEvents"> | null;
    selectedTaskSource?: "today" | "upcoming" | "week" | "other" | null;
    onSelectTask?: (id: Id<"userEvents">, source: "today" | "upcoming" | "week" | "other") => void;
    onClearTaskSelection?: () => void;

    // Actions
    onDocumentSelect: (documentId: Id<"documents">) => void;
    createTask: (args: { title: string; status?: string; dueDate?: number }) => Promise<any>;
    updateTask: (args: { id: Id<"userEvents">; status?: string; order?: number }) => Promise<any>;
    createEvent: (args: any) => Promise<any>;
    handleAddTaskForDate: (dateMs: number) => void;
    handleAddEventForDate: (dateMs: number) => void;
}

// ============================================================================
// Context Creation
// ============================================================================

const DocumentsHubContext = createContext<DocumentsHubContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

export interface DocumentsHubProviderProps {
    value: DocumentsHubContextValue;
    children: ReactNode;
}

export function DocumentsHubProvider({ value, children }: DocumentsHubProviderProps) {
    return (
        <DocumentsHubContext.Provider value={value}>
            {children}
        </DocumentsHubContext.Provider>
    );
}

// ============================================================================
// Hook
// ============================================================================

export function useDocumentsHub(): DocumentsHubContextValue {
    const context = useContext(DocumentsHubContext);
    if (!context) {
        throw new Error("useDocumentsHub must be used within a DocumentsHubProvider");
    }
    return context;
}

// ============================================================================
// Optional Hook (for components that may or may not be in provider)
// ============================================================================

export function useDocumentsHubOptional(): DocumentsHubContextValue | null {
    return useContext(DocumentsHubContext);
}
