import { LucideIcon } from "lucide-react";

// Source Configuration
export interface SourceConfig {
    id: string;
    name: string;
    shortName: string;
    icon: string;
    color: string;
    bgColor: string;
    borderColor: string;
    activeBgColor: string;
    activeBorderColor: string;
    trustScore: number; // 0-100
    freshness: 'realtime' | 'hourly' | 'daily';
    category: 'tech' | 'academic' | 'social' | 'news';
    keyboardShortcut: number;
    isLive: boolean;
}

export const SOURCES = [
    {
        id: 'ycombinator',
        name: 'YCombinator News',
        shortName: 'YC',
        icon: 'Y',
        color: 'text-orange-600',
        bgColor: 'bg-surface',
        borderColor: 'border-orange-200',
        activeBgColor: 'bg-orange-50',
        activeBorderColor: 'border-orange-300',
        trustScore: 95,
        freshness: 'realtime',
        category: 'tech',
        keyboardShortcut: 1,
        isLive: true,
    },
    {
        id: 'techcrunch',
        name: 'TechCrunch',
        shortName: 'TC',
        icon: 'T',
        color: 'text-blue-600',
        bgColor: 'bg-surface',
        borderColor: 'border-blue-200',
        activeBgColor: 'bg-blue-50',
        activeBorderColor: 'border-blue-300',
        trustScore: 90,
        freshness: 'hourly',
        category: 'news',
        keyboardShortcut: 2,
        isLive: false,
    },
    {
        id: 'reddit',
        name: 'Reddit',
        shortName: 'RD',
        icon: 'R',
        color: 'text-red-600',
        bgColor: 'bg-surface',
        borderColor: 'border-red-200',
        activeBgColor: 'bg-red-50',
        activeBorderColor: 'border-red-300',
        trustScore: 75,
        freshness: 'realtime',
        category: 'social',
        keyboardShortcut: 3,
        isLive: true,
    },
    {
        id: 'twitter',
        name: 'Twitter/X',
        shortName: 'X',
        icon: 'X',
        color: 'text-content',
        bgColor: 'bg-surface',
        borderColor: 'border-edge',
        activeBgColor: 'bg-surface-secondary',
        activeBorderColor: 'border-gray-400',
        trustScore: 70,
        freshness: 'realtime',
        category: 'social',
        keyboardShortcut: 4,
        isLive: true,
    },
    {
        id: 'github',
        name: 'GitHub',
        shortName: 'GH',
        icon: 'G',
        color: 'text-purple-600',
        bgColor: 'bg-surface',
        borderColor: 'border-purple-200',
        activeBgColor: 'bg-purple-50',
        activeBorderColor: 'border-purple-300',
        trustScore: 92,
        freshness: 'hourly',
        category: 'tech',
        keyboardShortcut: 5,
        isLive: false,
    },
    {
        id: 'arxiv',
        name: 'ArXiv',
        shortName: 'AR',
        icon: 'A',
        color: 'text-green-600',
        bgColor: 'bg-surface',
        borderColor: 'border-green-200',
        activeBgColor: 'bg-green-50',
        activeBorderColor: 'border-green-300',
        trustScore: 98,
        freshness: 'daily',
        category: 'academic',
        keyboardShortcut: 6,
        isLive: false,
    },
] as const satisfies readonly SourceConfig[];

export type Source = typeof SOURCES[number];

// Source Presets
export interface SourcePreset {
    id: string;
    name: string;
    description: string;
    sources: string[];
    icon: string;
    color: string;
}

export const SOURCE_PRESETS: SourcePreset[] = [
    {
        id: 'all',
        name: 'All Sources',
        description: 'Search across all available sources',
        sources: ['ycombinator', 'techcrunch', 'reddit', 'twitter', 'github', 'arxiv'],
        icon: '🌐',
        color: 'text-content-secondary',
    },
    {
        id: 'tech-news',
        name: 'Tech News',
        description: 'YC News, TechCrunch, GitHub',
        sources: ['ycombinator', 'techcrunch', 'github'],
        icon: '📰',
        color: 'text-blue-600',
    },
    {
        id: 'academic',
        name: 'Academic',
        description: 'ArXiv and research papers',
        sources: ['arxiv'],
        icon: '🎓',
        color: 'text-green-600',
    },
    {
        id: 'social',
        name: 'Social Media',
        description: 'Reddit and Twitter/X',
        sources: ['reddit', 'twitter'],
        icon: '💬',
        color: 'text-pink-600',
    },
    {
        id: 'high-trust',
        name: 'High Trust',
        description: 'Only sources with 90+ trust score',
        sources: ['ycombinator', 'techcrunch', 'github', 'arxiv'],
        icon: '⭐',
        color: 'text-yellow-600',
    },
];
