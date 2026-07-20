import React, { useMemo } from 'react';

interface CrossLinkedTextProps {
    text: string;
    /** Map of entity name (lowercase) to entity ID */
    entities?: Record<string, { id: string; name: string; type: string }>;
    onAskAI?: (prompt: string) => void;
    /** Optional direct handler for entity clicks */
    onEntityClick?: (entityName: string, entityType: string) => void;
    className?: string;
}

export function CrossLinkedText({ text, entities = {}, onAskAI, onEntityClick, className = "" }: CrossLinkedTextProps) {
    // Memoize the regex construction - must be called before any early returns
    const { regex, entityMap } = useMemo(() => {
        // Collect all entity names we want to match
        const names = Object.values(entities).map(e => e.name);

        // Add some default tech entities if not present (fallback/always-on)
        const defaults = ['OpenAI', 'Anthropic', 'Google', 'Microsoft', 'NVIDIA', 'Meta', 'Tesla'];
        defaults.forEach(d => {
            if (!names.includes(d)) names.push(d);
        });

        // Create a map for quick lookup by lowercase name
        const map = new Map<string, { name: string; type: string }>();
        Object.values(entities).forEach(e => {
            map.set(e.name.toLowerCase(), { name: e.name, type: e.type });
        });

        // Add defaults to map if missing
        defaults.forEach(d => {
            if (!map.has(d.toLowerCase())) {
                map.set(d.toLowerCase(), { name: d, type: 'company' });
            }
        });

        // Sort by length (longest first) to match specific entities before substrings
        const sortedNames = Array.from(map.values())
            .map(e => e.name)
            .sort((a, b) => b.length - a.length);

        // Escape regex special characters
        const escapedNames = sortedNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

        if (escapedNames.length === 0) return { regex: null, entityMap: map };

        return {
            regex: new RegExp(`(\\b${escapedNames.join('\\b|\\b')}\\b)`, 'gi'),
            entityMap: map
        };
    }, [entities]);

    // Early returns after all hooks are called
    if (!text) return null;
    if (!regex) return <span className={className}>{text}</span>;

    const parts = text.split(regex);

    return (
        <span className={className}>
            {parts.map((part, i) => {
                const lowerPart = part.toLowerCase();
                const matchedEntity = entityMap.get(lowerPart);

                if (matchedEntity) {
                    const type = matchedEntity.type;
                    return (
                        <span
                            key={i}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (onEntityClick) {
                                    onEntityClick(matchedEntity.name, type);
                                } else {
                                    onAskAI?.(`Provide a strategic deep-dive on: ${matchedEntity.name}`);
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.preventDefault();
                                e.stopPropagation();
                                if (onEntityClick) {
                                    onEntityClick(matchedEntity.name, type);
                                } else {
                                    onAskAI?.(`Provide a strategic deep-dive on: ${matchedEntity.name}`);
                                }
                            }}
                            className={`
                inline-flex items-center px-1.5 py-0.5 rounded-sm border-b border-dashed
                transition-all duration-300 font-bold tracking-tight cursor-pointer
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
                ${type === 'company' ? 'text-content border-gray-900/30 hover:bg-indigo-50' :
                                    type === 'person' ? 'text-indigo-900 border-indigo-900/30 hover:bg-indigo-50' :
                                        type === 'topic' ? 'text-content border-gray-900/30 hover:bg-surface-hover' :
                                            'text-content border-[color:var(--text-primary)]/30 hover:bg-surface-hover'}
              `}
                        >
                            {part}
                        </span>
                    );
                }

                return part;
            })}
        </span>
    );
}
