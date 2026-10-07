import { useMemo } from 'react';
import { AUDIT_MOCKS } from '../data/audit_mocks';

export type DealStage = 'Seed' | 'Series A' | 'Series B' | 'Series C+';
export type DealSector = 'Biotech' | 'Fintech' | 'AI/ML' | 'HealthTech' | 'Space' | 'Other';

export interface Deal {
    id: string;
    companyName: string;
    sector: DealSector;
    stage: DealStage;
    amount: number;
    currency: string;
    leadInvestor: string;
    announcedDate: string;
    hqLocation: string;
    bankerScore: number;
    entityData: any;
}

interface UseDealDataFilters {
    stage?: DealStage | 'all';
    sector?: DealSector | 'all';
    dateRange?: { start: string; end: string };
    minBankerScore?: number;
}

function calculateBankerScore(entityData: any): number {
    const hooks = entityData?.personaHooks?.JPM_STARTUP_BANKER;
    if (!hooks) return 0;

    const passCriteria = hooks.passCriteria || [];
    const failTriggers = hooks.failTriggers || [];

    // Base score
    let score = 50;

    // Add points for each pass criteria (max 50 points)
    score += Math.min(50, passCriteria.length * 10);

    // Deduct for fail triggers
    score -= failTriggers.length * 15;

    // Freshness bonus
    if (entityData?.freshness?.withinBankerWindow) {
        score += 20;
    }

    // Recent funding bonus
    const daysAgo = entityData?.freshness?.newsAgeDays || 999;
    if (daysAgo <= 7) score += 15;
    else if (daysAgo <= 30) score += 10;

    return Math.max(0, Math.min(100, score));
}

function extractDealsFromMocks(): Deal[] {
    const deals: Deal[] = [];

    Object.entries(AUDIT_MOCKS).forEach(([key, data]) => {
        // Skip config and non-company entries
        if (key === '__AUDIT_CONFIG__' || data.entityType === 'oss_project') return;

        const funding = data.funding;
        const lastRound = funding?.lastRound;

        if (!lastRound || !lastRound.announcedDate) return;

        // Map funding stage to DealStage
        let stage: DealStage = 'Seed';
        const roundType = lastRound.roundType?.toLowerCase() || '';
        if (roundType.includes('series a')) stage = 'Series A';
        else if (roundType.includes('series b')) stage = 'Series B';
        else if (roundType.includes('series c')) stage = 'Series C+';

        // Extract sector
        const sectors = data.crmFields?.sectors || [];
        let sector: DealSector = 'Other';
        if (sectors.some((s: string) => s.toLowerCase().includes('bio'))) sector = 'Biotech';
        else if (sectors.some((s: string) => s.toLowerCase().includes('fintech'))) sector = 'Fintech';
        else if (sectors.some((s: string) => /ai|ml/i.test(s))) sector = 'AI/ML';
        else if (sectors.some((s: string) => /health/i.test(s))) sector = 'HealthTech';
        else if (sectors.some((s: string) => /space/i.test(s))) sector = 'Space';

        deals.push({
            id: key,
            companyName: data.canonicalName || key,
            sector,
            stage,
            amount: lastRound.amount?.amount || 0,
            currency: lastRound.amount?.currency || 'USD',
            leadInvestor: lastRound.coLeads?.[0] || 'Undisclosed',
            announcedDate: lastRound.announcedDate,
            hqLocation: data.crmFields?.hqLocation || 'Unknown',
            bankerScore: calculateBankerScore(data),
            entityData: data,
        });
    });

    return deals;
}

export function useDealData(filters: UseDealDataFilters = {}) {
    const allDeals = useMemo(() => extractDealsFromMocks(), []);

    const filteredDeals = useMemo(() => {
        let result = [...allDeals];

        // Stage filter
        if (filters.stage && filters.stage !== 'all') {
            result = result.filter(d => d.stage === filters.stage);
        }

        // Sector filter
        if (filters.sector && filters.sector !== 'all') {
            result = result.filter(d => d.sector === filters.sector);
        }

        // Date range filter
        if (filters.dateRange) {
            result = result.filter(d => {
                const dealDate = new Date(d.announcedDate);
                const start = new Date(filters.dateRange!.start);
                const end = new Date(filters.dateRange!.end);
                return dealDate >= start && dealDate <= end;
            });
        }

        // Banker score filter
        if (filters.minBankerScore !== undefined) {
            result = result.filter(d => d.bankerScore >= filters.minBankerScore!);
        }

        // Sort by date (newest first)
        result.sort((a, b) => new Date(b.announcedDate).getTime() - new Date(a.announcedDate).getTime());

        return result;
    }, [allDeals, filters]);

    const stats = useMemo(() => ({
        total: allDeals.length,
        filtered: filteredDeals.length,
        avgBankerScore: filteredDeals.length > 0
            ? Math.round(filteredDeals.reduce((sum, d) => sum + d.bankerScore, 0) / filteredDeals.length)
            : 0,
        byStage: {
            'Seed': filteredDeals.filter(d => d.stage === 'Seed').length,
            'Series A': filteredDeals.filter(d => d.stage === 'Series A').length,
            'Series B': filteredDeals.filter(d => d.stage === 'Series B').length,
            'Series C+': filteredDeals.filter(d => d.stage === 'Series C+').length,
        },
    }), [allDeals, filteredDeals]);

    return {
        deals: filteredDeals,
        stats,
    };
}
