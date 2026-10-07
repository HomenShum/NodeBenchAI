# OpenBB Agent

Specialized agent for financial data and market research powered by OpenBB Platform.

## 🎯 Purpose

The OpenBB Agent provides access to comprehensive financial market data including stocks, cryptocurrencies, economic indicators, and financial news.

## 🔧 Capabilities

### Stock Market Data
- Real-time and historical stock prices
- Company fundamentals (P/E, market cap, revenue)
- Multi-stock comparisons
- Price trend analysis

### Cryptocurrency Data
- Crypto prices and historical data
- Market cap and volume data
- Cryptocurrency trends

### Economic Indicators
- GDP data and growth rates
- Employment and unemployment statistics
- Inflation data (CPI, PPI)
- Economic trends

### Financial News
- Company-specific news
- Market news and headlines
- Breaking financial news
- News by category

## 📁 Tools

### Admin Tools
- `availableCategories` - List available data categories
- `availableTools` - List available tools
- `activateTools` - Activate specific tools or categories

### Equity Tools
- `getStockPrice` - Get stock price data
- `getStockFundamentals` - Get company fundamentals
- `compareStocks` - Compare multiple stocks

### Crypto Tools
- `getCryptoPrice` - Get cryptocurrency prices
- `getCryptoMarketData` - Get crypto market data

### Economy Tools
- `getGDP` - Get GDP data
- `getEmploymentData` - Get employment statistics
- `getInflationData` - Get inflation data

### News Tools
- `getCompanyNews` - Get company-specific news
- `getMarketNews` - Get market news

## 🚀 Usage

```typescript
import { createOpenBBAgent } from "./openbbAgent";

const agent = createOpenBBAgent("gpt-4o");
```

## 🔗 Integration

The OpenBB Agent communicates with the OpenBB MCP server via `convex/actions/openbbActions.ts`.

## 📞 Owner

Financial Data Team

