// src/features/research/utils/newsletterParser.ts
// Parse markdown content into structured newsletter sections

import { matchSectionKey, generateSectionId, DOSSIER_SECTION_KEYS } from '../../../../shared/sectionIds';
import type { ReactNode } from 'react';

export interface ParsedBullet {
    text: string;
    evidenceChips: string[];
}

export interface ParsedSection {
    key: string;
    title: string;
    sectionId: string;
    content: string;
    bullets: ParsedBullet[];
    freshness: 'new' | 'updated' | 'stable';
    confidence?: string;
    startIndex: number;
    endIndex: number;
}

export interface DossierParseResult {
    sections: ParsedSection[];
    contentBeforeFirstSection: string;
}

const H3_REGEX = /^###\s+(.+)$/gm;
const FACT_ANCHOR_REGEX = /\{\{fact:([a-zA-Z0-9_-]+)\}\}/g;

function extractFactIds(text: string): string[] {
    const matches = text.matchAll(FACT_ANCHOR_REGEX);
    return Array.from(matches, m => m[1]);
}

function parseBullets(sectionContent: string): ParsedBullet[] {
    const bullets: ParsedBullet[] = [];
    const lines = sectionContent.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/^[-*•]\s+/)) {
            const text = trimmed.replace(/^[-*•]\s+/, '');
            const evidenceChips = extractFactIds(text);
            const cleanText = text.replace(FACT_ANCHOR_REGEX, '').trim();
            bullets.push({ text: cleanText, evidenceChips });
        }
    }
    return bullets;
}

function determineFreshness(content: string): 'new' | 'updated' | 'stable' {
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('new') || lowerContent.includes('recent') || lowerContent.includes('latest')) return 'new';
    if (lowerContent.includes('updated') || lowerContent.includes('revised')) return 'updated';
    return 'stable';
}

export function parseMarkdownToDossier(markdown: string, runId: string): DossierParseResult {
    const sections: ParsedSection[] = [];
    const headingMatches: Array<{ heading: string; index: number }> = [];
    let match;
    H3_REGEX.lastIndex = 0;
    while ((match = H3_REGEX.exec(markdown)) !== null) {
        headingMatches.push({ heading: match[1], index: match.index });
    }
    const contentBeforeFirstSection = headingMatches.length > 0 ? markdown.slice(0, headingMatches[0].index) : '';
    for (let i = 0; i < headingMatches.length; i++) {
        const current = headingMatches[i];
        const nextIndex = i < headingMatches.length - 1 ? headingMatches[i + 1].index : markdown.length;
        const content = markdown.slice(current.index, nextIndex);
        const headingText = current.heading;
        const confidenceMatch = headingText.match(/\(Confidence:?\s*([a-zA-Z0-9\s-]+)\)/i);
        let title = headingText;
        let confidence = undefined;
        if (confidenceMatch) {
            confidence = confidenceMatch[1].trim();
            title = headingText.replace(confidenceMatch[0], '').trim();
        }
        const sectionKey = matchSectionKey(title);
        const sectionId = generateSectionId(runId, sectionKey);
        const bullets = parseBullets(content);
        const freshness = determineFreshness(content);
        sections.push({ key: sectionKey, title, confidence, sectionId, content, bullets, freshness, startIndex: current.index, endIndex: nextIndex });
    }
    return { sections, contentBeforeFirstSection };
}

export function groupArtifactsBySection(artifacts: Array<{ sectionId?: string;[key: string]: any }>, sections: ParsedSection[]): Map<string, any[]> {
    const grouped = new Map<string, any[]>();
    sections.forEach(section => grouped.set(section.sectionId, []));
    artifacts.forEach(artifact => {
        if (artifact.sectionId && grouped.has(artifact.sectionId)) {
            grouped.get(artifact.sectionId)!.push(artifact);
        }
    });
    return grouped;
}
