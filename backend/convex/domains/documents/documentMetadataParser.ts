/**
 * Utility to parse metadata from document content.
 * Extracts structured data from the metadata header lines we add to event/task documents.
 */

export interface ParsedMetadata {
  title: string;
  startTime?: number;
  endTime?: number;
  dueDate?: number;
  status?: string;
  priority?: string;
  location?: string;
  allDay?: boolean;
}

/**
 * Parse ProseMirror JSON content to extract metadata
 */
export function parseDocumentMetadata(content: string | undefined, title: string): ParsedMetadata {
  const result: ParsedMetadata = { title };

  if (!content) return result;

  try {
    const parsed = JSON.parse(content);
    if (!parsed || !parsed.content || !Array.isArray(parsed.content)) {
      return result;
    }

    // Extract text from all paragraphs
    const lines: string[] = [];
    for (const node of parsed.content) {
      if (node.type === "paragraph" && node.content) {
        const text = node.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("");
        if (text) lines.push(text);
      }
    }

    // Parse metadata lines
    for (const line of lines) {
      // Event time: "⏰ Time: 1/15/2025, 3:00:00 PM - 4:00:00 PM"
      if (line.includes("⏰ Time:") || line.includes("Time:")) {
        const timeStr = line.replace(/^.*Time:\s*/, "").trim();
        const parsed = parseTimeString(timeStr);
        if (parsed.startTime) result.startTime = parsed.startTime;
        if (parsed.endTime) result.endTime = parsed.endTime;
        if (parsed.allDay !== undefined) result.allDay = parsed.allDay;
      }

      // Task due date: "📅 Due: 1/15/2025, 3:00:00 PM"
      if (line.includes("📅 Due:") || line.includes("Due:")) {
        const dueStr = line.replace(/^.*Due:\s*/, "").trim();
        if (dueStr !== "No due date") {
          const dueTime = parseSingleDate(dueStr);
          if (dueTime) result.dueDate = dueTime;
        }
      }

      // Status: "Status: confirmed" or "Status: todo"
      if (line.includes("Status:")) {
        const status = line.replace(/^.*Status:\s*/, "").trim().toLowerCase();
        if (status) result.status = status;
      }

      // Priority: "Priority: high"
      if (line.includes("Priority:")) {
        const priority = line.replace(/^.*Priority:\s*/, "").trim().toLowerCase();
        if (priority) result.priority = priority;
      }

      // Location: "📍 Location: Conference Room A"
      if (line.includes("📍 Location:") || line.includes("Location:")) {
        const location = line.replace(/^.*Location:\s*/, "").trim();
        if (location) result.location = location;
      }
    }
  } catch (e) {
    // Failed to parse, return what we have
    console.warn("Failed to parse document metadata:", e);
  }

  return result;
}

/**
 * Parse a time string that might be:
 * - A single date: "1/15/2025, 3:00:00 PM"
 * - A date range: "1/15/2025, 3:00:00 PM - 4:00:00 PM"
 * - A date only: "1/15/2025"
 */
function parseTimeString(timeStr: string): { startTime?: number; endTime?: number; allDay?: boolean } {
  const result: { startTime?: number; endTime?: number; allDay?: boolean } = {};

  // Check if it's a range (contains " - ")
  if (timeStr.includes(" - ")) {
    const parts = timeStr.split(" - ");
    if (parts.length === 2) {
      const start = parseSingleDate(parts[0].trim());
      const end = parseSingleDate(parts[1].trim());
      if (start) result.startTime = start;
      if (end) result.endTime = end;
      result.allDay = false;
    }
  } else {
    // Single date/time
    const time = parseSingleDate(timeStr);
    if (time) {
      result.startTime = time;
      // Check if it's a date-only format (no time component)
      result.allDay = !timeStr.includes(":");
    }
  }

  return result;
}

/**
 * Parse a single date string to timestamp
 * Handles formats like:
 * - "1/15/2025, 3:00:00 PM"
 * - "1/15/2025"
 * - "January 15, 2025"
 */
function parseSingleDate(dateStr: string): number | undefined {
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

/**
 * Helper to convert parsed metadata back to event-like object for UI
 */
export function metadataToEventLike(doc: any, metadata: ParsedMetadata): any {
  return {
    _id: doc._id,
    title: metadata.title || doc.title,
    startTime: metadata.startTime || doc.createdAt,
    endTime: metadata.endTime,
    allDay: metadata.allDay,
    status: metadata.status,
    location: metadata.location,
    description: "", // Could extract from content if needed
    documentId: doc._id,
  };
}

/**
 * Helper to convert parsed metadata back to task-like object for UI
 */
export function metadataToTaskLike(doc: any, metadata: ParsedMetadata): any {
  return {
    _id: doc._id,
    title: metadata.title || doc.title,
    dueDate: metadata.dueDate || doc.createdAt,
    status: metadata.status || "todo",
    priority: metadata.priority,
    description: "", // Could extract from content if needed
    documentId: doc._id,
  };
}

