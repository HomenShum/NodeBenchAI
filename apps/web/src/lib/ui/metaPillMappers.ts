// src/lib/metaPillMappers.ts
export type FileType = 'document' | 'pdf' | 'csv' | 'audio' | 'video' | 'url' | 'calendar' | 'task';
export type PillKind = 'type' | 'project' | 'when' | 'link' | 'updated' | 'details';

export interface Pill {
  kind: PillKind;
  icon: string; // emoji or short text icon
  label: string;
  href?: string; // only for link pills
}

const ICONS: Record<string, string> = {
  document: '📄',
  pdf: '📕',
  csv: '📈',
  audio: '🎵',
  video: '🎬',
  url: '🌐',
  calendar: '📅',
  task: '🗓️',
  project: '📁',
  link: '🔗',
  updated: '🕐',
  details: '📝',
};

const isUrlish = (s?: string) => !!s && (/^(https?:)?\/\//i.test(s) || /\.[a-z]{2,}(\/|$)/i.test(s));

const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 4) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
};

// ---- Helpers inspired by user's mapper --------------------------------------------------
const toMillis = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const d = new Date(v);
    const t = d.getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
};
const labelizeType = (t?: string) => {
  const k = (t || '').toLowerCase();
  const map: Record<string, string> = {
    document: 'Doc',
    doc: 'Doc',
    pdf: 'PDF',
    csv: 'Spreadsheet',
    excel: 'Spreadsheet',
    spreadsheet: 'Spreadsheet',
    sheet: 'Spreadsheet',
    url: 'Link',
    calendar: 'Calendar',
    audio: 'Audio',
    video: 'Video',
    slide: 'Slides',
  };
  return map[k] || (k ? k[0].toUpperCase() + k.slice(1) : 'Doc');
};

const normalizeUrl = (u?: string) => {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    return url.toString();
  } catch {
    try {
      const url = new URL('https://' + u);
      return url.toString();
    } catch {
      return undefined;
    }
  }
};

const hostFromUrl = (u?: string) => {
  try {
    const h = new URL(u!).hostname.replace(/^www\./, '');
    return h || u;
  } catch {
    return u;
  }
};

const coalesce = <T>(...vals: Array<T | undefined | null>) => vals.find(Boolean) as T | undefined;

// Normalize a variety of doc type guesses to our Pill FileType set
const normalizeDocType = (t: any): FileType => {
  const s = String(t || '').toLowerCase();
  if (!s) return 'document';
  if (s === 'calendar') return 'calendar';
  if (s === 'pdf') return 'pdf';
  if (s === 'csv' || s === 'excel' || s === 'sheet' || s === 'spreadsheet') return 'csv';
  if (s === 'audio' || s === 'mp3' || s === 'wav') return 'audio';
  if (s === 'video' || s === 'mp4' || s === 'mov' || s === 'webm') return 'video';
  if (s === 'web' || s === 'url' || s === 'link') return 'url';
  // Map everything else (nbdoc, text, document, image, code, json, unknown, etc) to 'document'
  return 'document';
};

// Types tolerated by the mapper (loose on purpose)
type Tag = { name: string; kind?: string; importance?: number };
type Doc = {
  _id: string;
  title?: string;
  typeGuess?: string; // existing theming signal (e.g., from inferFileType)
  lastModified?: string | number | Date;
  url?: string;
  sourceUrl?: string;
  projectName?: string;
  project?: string;
  labels?: Array<{ name?: string; kind?: string }>; // legacy
  tags?: Tag[];
  meta?: {
    type?: string;
    project?: string;
    when?: string; // human label like "Q2 2024", "Today 3pm"
    link?: string; // canonical source/share url
    updated?: string; // ISO 8601
    details?: string; // blurb ≤140 chars
  };
};

// Optional: lightweight fallback if project not explicitly set
const inferProjectFromTags = (tags?: Tag[]) => {
  if (!tags?.length) return undefined;
  const cand = tags
    .filter((t) => (t.kind === 'entity' || t.kind === 'topic') && (t.importance ?? 0) >= 0.4)
    .map((t) => t.name)[0];
  return cand;
};

export const docToPills = (doc: Doc): Pill[] => {
  const pills: Pill[] = [];

  // TYPE: prefer explicit meta.type, fall back to caller-provided typeGuess
  const typeRaw = coalesce<string>(doc.meta?.type, doc.typeGuess);
  if (typeRaw) {
    const normalized = normalizeDocType(typeRaw);
    pills.push({ kind: 'type', icon: ICONS[normalized] || ICONS.document, label: labelizeType(typeRaw) });
  }

  // PROJECT: meta.project > projectName > inferred from tags > legacy doc.project/labels
  const legacyProject = doc.project || doc.labels?.find?.((l) => l?.kind === 'project')?.name;
  const project = coalesce<string>(doc.meta?.project, doc.projectName, inferProjectFromTags(doc.tags), legacyProject as any);
  if (project) {
    pills.push({ kind: 'project', icon: ICONS.project, label: String(project) });
  }

  // WHEN: human label if provided, else time-ago from lastModified
  const lastModMs = toMillis(doc.lastModified as any);
  const whenLabel = doc.meta?.when ?? (lastModMs != null ? formatTimeAgo(lastModMs) : 'Just created');
  if (whenLabel) {
    pills.push({ kind: 'when', icon: ICONS.calendar, label: String(whenLabel) });
  }

  // LINK: normalize and show hostname as label
  const href = normalizeUrl(coalesce<string>(doc.meta?.link, doc.sourceUrl, doc.url));
  if (href && isUrlish(href)) {
    pills.push({ kind: 'link', icon: ICONS.link, label: hostFromUrl(href) ?? 'Link', href });
  }

  // UPDATED: explicit ISO/number timestamp
  if (doc.meta?.updated) {
    const updatedMs = toMillis(doc.meta.updated as any);
    if (updatedMs != null) {
      const updatedLabel = `Updated ${formatTimeAgo(updatedMs)}`;
      pills.push({ kind: 'updated', icon: ICONS.updated, label: updatedLabel });
    }
  }

  // DETAILS: short blurb
  if (doc.meta?.details) {
    pills.push({ kind: 'details', icon: ICONS.details, label: String(doc.meta.details) });
  }

  return pills.slice(0, 5);
};

type Task = {
  title?: string;
  dueAt?: string; // ISO
  project?: string;
  link?: string;
  updatedAt?: string | number | Date; // ISO or number
  priority?: 'low' | 'med' | 'high' | 'urgent' | number;
  details?: string;
  note?: string;
  description?: string;
  subtitle?: string;
};

const labelPriority = (p?: Task['priority']) => {
  if (p === undefined || p === null) return undefined;
  if (typeof p === 'number') return `P${p}`;
  const map: Record<string, string> = { low: 'P4', med: 'P3', high: 'P2', urgent: 'P1' };
  return map[String(p)] ?? String(p);
};

const labelDue = (iso?: string) => {
  if (!iso) return undefined;
  try {
    const d = new Date(iso);
    const now = new Date();
    const ms = d.getTime() - now.getTime();
    const day = 24 * 60 * 60 * 1000;
    if (ms < -day) return `Overdue ${formatTimeAgo(d.getTime())}`;
    if (ms < 0) return 'Overdue today';
    if (ms < day) return 'Due today';
    if (ms < 2 * day) return 'Due tomorrow';
    return `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } catch {
    return undefined;
  }
};

export const taskToPills = (task: Task): Pill[] => {
  const pills: Pill[] = [];

  // TYPE
  pills.push({ kind: 'type', icon: ICONS.task, label: 'Task' });

  // PROJECT
  if (task.project) pills.push({ kind: 'project', icon: ICONS.project, label: task.project });

  // WHEN
  const when = labelDue(task.dueAt);
  if (when) pills.push({ kind: 'when', icon: ICONS.calendar, label: when });

  // LINK
  const href = normalizeUrl(task.link);
  if (href && isUrlish(href)) pills.push({ kind: 'link', icon: ICONS.link, label: hostFromUrl(href) ?? 'Link', href });

  // UPDATED
  if (task.updatedAt) {
    const whenUpdated = toMillis(task.updatedAt as any);
    if (whenUpdated != null) {
      pills.push({ kind: 'updated', icon: ICONS.updated, label: `Updated ${formatTimeAgo(whenUpdated)}` });
    }
  }

  // DETAILS
  const prio = labelPriority(task.priority);
  const details = task.details ?? task.note ?? task.description ?? task.subtitle ?? prio;
  if (details) pills.push({ kind: 'details', icon: ICONS.details, label: String(details) });

  return pills.slice(0, 5);
};
