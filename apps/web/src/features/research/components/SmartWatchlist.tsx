import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Sparkline, generateSparklineData } from '@/components/ui/Sparkline';
import { 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  ChevronRight, 
  Bell,
  BellOff,
  MoreHorizontal,
  RefreshCw,
  Zap,
  Search,
  X,
  AlertTriangle,
  FileText,
  Activity,
  Clock
} from 'lucide-react';

interface DeltaInfo {
  type: 'price_spike' | 'news_mention' | 'volume_surge' | 'sentiment_shift' | 'filing';
  description: string;
  severity: 'high' | 'medium' | 'low';
  timestamp: number;
}

interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  sparklineData: number[];
  hasAlert: boolean;
  sector?: string;
  deltas?: DeltaInfo[]; // Track what changed since last check
  lastChecked?: number; // Timestamp of last verification
  verificationStatus?: 'verified' | 'unverified' | 'stale';
}

interface SmartWatchlistProps {
  onItemClick?: (symbol: string) => void;
  onAnalyze?: (symbol: string) => void;
  mentions?: Array<{
    symbol: string;
    headline: string;
    source?: string;
    time?: string;
    url?: string;
  }>;
}

// Simulated watchlist data - in production this would come from API/user preferences
const DEMO_WATCHLIST: WatchlistItem[] = [
  { 
    symbol: 'AAPL', 
    name: 'Apple Inc.', 
    price: 193.42, 
    change: 2.34, 
    changePercent: 1.22,
    sparklineData: generateSparklineData(20, 0.015),
    hasAlert: true,
    sector: 'Technology'
  },
  { 
    symbol: 'NVDA', 
    name: 'NVIDIA Corp.', 
    price: 467.85, 
    change: 12.47, 
    changePercent: 2.74,
    sparklineData: generateSparklineData(20, 0.025),
    hasAlert: false,
    sector: 'Semiconductors'
  },
  { 
    symbol: 'MSFT', 
    name: 'Microsoft', 
    price: 378.21, 
    change: -1.89, 
    changePercent: -0.50,
    sparklineData: generateSparklineData(20, 0.01),
    hasAlert: false,
    sector: 'Technology'
  },
  { 
    symbol: 'GOOGL', 
    name: 'Alphabet Inc.', 
    price: 141.32, 
    change: 0.78, 
    changePercent: 0.55,
    sparklineData: generateSparklineData(20, 0.018),
    hasAlert: true,
    sector: 'Technology'
  },
];

export const SmartWatchlist: React.FC<SmartWatchlistProps> = ({ 
  onItemClick, 
  onAnalyze,
  mentions = []
}) => {
  const STORAGE_KEY = 'smart_watchlist_items';
  const loadStoredItems = (): WatchlistItem[] => {
    if (typeof window === 'undefined') return DEMO_WATCHLIST;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEMO_WATCHLIST;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // ignore
    }
    return DEMO_WATCHLIST;
  };

  const [items, setItems] = useState<WatchlistItem[]>(loadStoredItems);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<WatchlistItem | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const detailStats = useMemo(() => {
    if (!selectedItem) return null;
    const seed = selectedItem.symbol
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const volume = 20 + (seed % 80);
    return {
      dayRange: `${(selectedItem.price * 0.97).toFixed(2)} - ${(selectedItem.price * 1.02).toFixed(2)}`,
      range52w: `${(selectedItem.price * 0.72).toFixed(2)} - ${(selectedItem.price * 1.18).toFixed(2)}`,
      volume: `${volume.toFixed(1)}M`,
      sentiment: selectedItem.changePercent >= 0 ? 'Bullish momentum' : 'Pullback watch'
    };
  }, [selectedItem]);

  // Persist watchlist locally
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore
    }
  }, [items]);

  // Simulate live price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setItems(prev => prev.map(item => {
        const priceChange = (Math.random() - 0.5) * 0.5;
        const newPrice = item.price + priceChange;
        const newChange = item.change + priceChange;
        const newChangePercent = (newChange / (newPrice - newChange)) * 100;
        
        // Add new data point to sparkline
        const newSparkline = [...item.sparklineData.slice(1), newPrice];
        
        return {
          ...item,
          price: Math.round(newPrice * 100) / 100,
          change: Math.round(newChange * 100) / 100,
          changePercent: Math.round(newChangePercent * 100) / 100,
          sparklineData: newSparkline,
        };
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const gainers = items.filter(i => i.changePercent > 0).length;
  const losers = items.filter(i => i.changePercent < 0).length;

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.trim().toLowerCase();
    return items.filter(item =>
      item.symbol.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  const addToWatchlist = (item: WatchlistItem) => {
    setItems(prev => {
      if (prev.some(existing => existing.symbol === item.symbol)) return prev;
      return [item, ...prev].slice(0, 25);
    });
  };

  const toggleAlert = (symbol: string) => {
    setItems(prev =>
      prev.map(item =>
        item.symbol === symbol ? { ...item, hasAlert: !item.hasAlert } : item
      )
    );
  };

  const selectItem = (item: WatchlistItem) => {
    setSelectedItem(item);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const query = searchQuery.trim().toUpperCase();
    const existing = items.find(i => i.symbol.toUpperCase() === query);
    if (existing) {
      setSelectedItem(existing);
      return;
    }

    // Create a lightweight synthetic item for quick lookups
    const basePrice = 50 + Math.random() * 250;
    const synthetic: WatchlistItem = {
      symbol: query.slice(0, 6),
      name: `${query} Corporation`,
      price: Math.round(basePrice * 100) / 100,
      change: Math.round((Math.random() - 0.5) * 4 * 100) / 100,
      changePercent: Math.round((Math.random() - 0.5) * 3 * 100) / 100,
      sparklineData: generateSparklineData(20, 0.02),
      hasAlert: false,
      sector: 'Search result'
    };
    setSelectedItem(synthetic);
  };

  const closeDetail = () => setSelectedItem(null);
  const isTracked = !!(selectedItem && items.some(i => i.symbol === selectedItem.symbol));

  const recentMentions = useMemo(() => {
    if (!selectedItem) return [];
    return mentions
      .filter((m) => m.symbol.toUpperCase() === selectedItem.symbol.toUpperCase())
      .slice(0, 4);
  }, [mentions, selectedItem]);

  return (
    <div className="relative p-5 rounded-lg border border-edge bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)] transition-shadow">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-content">Watchlist</h3>
          <span className="flex items-center gap-1 text-xs text-content-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 motion-safe:animate-pulse" />
            Live
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg text-content-secondary hover:text-content hover:bg-surface-hover transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`} />
          </button>
          <button className="p-1.5 rounded-lg text-content-secondary hover:text-content hover:bg-surface-hover transition-colors">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-edge bg-surface-secondary">
        <Search className="w-4 h-4 text-content-secondary" />
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search or jump to a symbol"
          className="flex-1 bg-transparent text-sm text-content placeholder:text-content-secondary focus:outline-none"
        />
        <button
          type="submit"
          className="text-xs font-semibold text-content px-2 py-1 rounded-md border border-edge hover:bg-surface transition-colors"
        >
          Open
        </button>
      </form>

      {/* Summary Pills */}
      <div className="flex gap-2 mb-4">
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 text-green-700 text-xs font-medium">
          <TrendingUp className="w-3 h-3" />
          {gainers} up
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 text-red-700 text-xs font-medium">
          <TrendingDown className="w-3 h-3" />
          {losers} down
        </div>
      </div>

      {/* Items */}
      <div className="space-y-1">
        {filteredItems.map((item) => (
          <div
            key={item.symbol}
            onClick={() => selectItem(item)}
            onMouseEnter={() => setHoveredSymbol(item.symbol)}
            onMouseLeave={() => setHoveredSymbol(null)}
            className="relative flex items-center justify-between py-3 px-3 -mx-1 rounded-lg hover:bg-surface-hover cursor-pointer transition-all group"
          >
            {/* Left: Symbol & Name */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-content">{item.symbol}</span>
                {item.hasAlert && (
                  <Bell className="w-3 h-3 text-amber-500" />
                )}
                {/* Delta indicator badge */}
                {item.deltas && item.deltas.length > 0 && (
                  <span 
                    className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200"
                    title={`${item.deltas.length} change${item.deltas.length > 1 ? 's' : ''} detected`}
                  >
                    <Activity className="w-2.5 h-2.5" />
                    {item.deltas.length}
                  </span>
                )}
                {/* Verification status badge */}
                {item.verificationStatus === 'verified' && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200">✓</span>
                )}
                {item.verificationStatus === 'stale' && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-surface-secondary text-content-secondary border border-edge" title="Data may be stale">
                    <Clock className="w-2.5 h-2.5 inline" />
                  </span>
                )}
              </div>
              <span className="text-xs text-content-secondary truncate block">{item.name}</span>
            </div>

            {/* Center: Sparkline */}
            <div className="px-3 opacity-80 group-hover:opacity-100 transition-opacity">
              <Sparkline 
                data={item.sparklineData} 
                width={50} 
                height={24}
                color={item.changePercent >= 0 ? '#22c55e' : '#ef4444'}
              />
            </div>

            {/* Right: Price & Change */}
            <div className="text-right min-w-[70px]">
              <div className="text-sm font-mono font-semibold text-content">
                ${item.price.toFixed(2)}
              </div>
              <div className={`text-xs font-medium flex items-center justify-end gap-0.5 ${
                item.changePercent >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {item.changePercent >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
              </div>
            </div>

            {/* Hover Overlay: Quick Actions */}
            {hoveredSymbol === item.symbol && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-surface shadow-lg rounded-lg px-1 py-0.5 border border-edge">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAnalyze?.(item.symbol);
                  }}
                  className="p-1.5 rounded-md text-purple-600 hover:bg-purple-50 transition-colors"
                  title="Analyze with AI"
                >
                  <Zap className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAlert(item.symbol);
                  }}
                  className="p-1.5 rounded-md text-content-secondary hover:bg-surface-hover transition-colors"
                  title={item.hasAlert ? 'Remove alert' : 'Set alert'}
                >
                  {item.hasAlert ? (
                    <BellOff className="w-3.5 h-3.5" />
                  ) : (
                    <Bell className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add to Watchlist */}
      <button
        type="button"
        className="mt-4 w-full py-2.5 text-xs font-medium text-content-secondary hover:text-content border border-dashed border-edge rounded-lg hover:bg-surface-hover hover:border-edge transition-all flex items-center justify-center gap-1.5"
        onClick={() => searchInputRef.current?.focus()}
      >
        <Plus className="w-3.5 h-3.5" />
        Add to watchlist
      </button>

      {/* Detail Drawer */}
      {selectedItem && (
        <div className="fixed inset-0 z-[120] flex items-start justify-end pointer-events-none">
          <div
            className="absolute inset-0 bg-black/10 pointer-events-auto"
            onClick={closeDetail}
          />
          <div className="relative pointer-events-auto mt-14 mr-6 w-[380px] max-w-[92vw] bg-surface border border-edge shadow-2xl rounded-lg overflow-hidden">
            <div className="flex items-start justify-between px-4 py-3 border-b border-edge">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-content">{selectedItem.symbol}</span>
                  <span className="text-xs font-medium text-content-secondary px-2 py-0.5 rounded-full bg-surface-secondary">
                    {selectedItem.sector || 'Equity'}
                  </span>
                </div>
                <p className="text-sm text-content-secondary">{selectedItem.name}</p>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="p-2 text-content-secondary hover:text-content hover:bg-surface-hover rounded-md transition-colors"
                aria-label="Close stock details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-mono font-semibold text-content">${selectedItem.price.toFixed(2)}</div>
                  <div className={`text-xs font-semibold flex items-center gap-1 ${selectedItem.changePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {selectedItem.changePercent >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {selectedItem.changePercent >= 0 ? '+' : ''}{selectedItem.changePercent.toFixed(2)}%
                    <span className="text-content-secondary">({selectedItem.change >= 0 ? '+' : ''}{selectedItem.change.toFixed(2)})</span>
                  </div>
                </div>
                <div className="w-32">
                  <Sparkline 
                    data={selectedItem.sparklineData}
                    width={120}
                    height={40}
                    color={selectedItem.changePercent >= 0 ? '#16a34a' : '#ef4444'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-content">
                <div className="rounded-lg border border-edge p-2 bg-surface-secondary">
                  <p className="text-xs text-content-secondary">Day range</p>
                  <p className="font-semibold">${detailStats?.dayRange}</p>
                </div>
                <div className="rounded-lg border border-edge p-2 bg-surface-secondary">
                  <p className="text-xs text-content-secondary">52w range</p>
                  <p className="font-semibold">${detailStats?.range52w}</p>
                </div>
                <div className="rounded-lg border border-edge p-2 bg-surface-secondary">
                  <p className="text-xs text-content-secondary">Volume est.</p>
                  <p className="font-semibold">{detailStats?.volume}</p>
                </div>
                <div className="rounded-lg border border-edge p-2 bg-surface-secondary">
                  <p className="text-xs text-content-secondary">Sentiment</p>
                  <p className="font-semibold">{detailStats?.sentiment}</p>
                </div>
              </div>

              <div className="rounded-lg border border-edge bg-surface-secondary p-3">
                <p className="text-xs font-semibold text-content-secondary mb-1">Recent mentions</p>
                {recentMentions.length === 0 ? (
                  <p className="text-sm text-content-secondary">No fresh mentions yet. Try a quick brief.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-content">
                    {recentMentions.map((mention, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-surface-secondary" />
                        <div className="flex-1">
                          <p className="text-sm text-content leading-snug">{mention.headline}</p>
                          <p className="text-xs text-content-secondary">
                            {mention.source || 'Signal'}
                            {mention.time ? ` • ${mention.time}` : ''}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedItem) addToWatchlist(selectedItem);
                  }}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${isTracked
                    ? 'border-green-200 bg-green-50 text-green-800 cursor-default'
                    : 'border-edge bg-surface text-content hover:bg-surface-hover'}`}
                  disabled={!!isTracked}
                >
                  <Plus className="w-4 h-4" />
                  {isTracked ? 'Tracked' : 'Track'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAnalyze?.(selectedItem.symbol);
                    closeDetail();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 text-white text-sm font-semibold px-3 py-2 hover:bg-gray-800 transition-colors"
                >
                  <Zap className="w-4 h-4" />
                  Open in Fast Agent
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onItemClick?.(selectedItem.symbol);
                    closeDetail();
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-edge bg-surface text-sm font-semibold px-3 py-2 hover:bg-surface-hover transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                  Quick brief
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
