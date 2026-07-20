import React, { useMemo } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  gradientFrom?: string;
  gradientTo?: string;
  showDot?: boolean;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 60,
  height = 20,
  color,
  gradientFrom,
  gradientTo,
  showDot = true,
  className = '',
}) => {
  const { path, areaPath, lastPoint, isUp } = useMemo(() => {
    if (data.length < 2) return { path: '', areaPath: '', lastPoint: { x: 0, y: 0 }, isUp: true };

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    
    const padding = 2;
    const effectiveWidth = width - padding * 2;
    const effectiveHeight = height - padding * 2;
    
    const points = data.map((value, index) => ({
      x: padding + (index / (data.length - 1)) * effectiveWidth,
      y: padding + effectiveHeight - ((value - min) / range) * effectiveHeight,
    }));

    // Create smooth curve path
    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpX = (prev.x + curr.x) / 2;
      pathD += ` C ${cpX} ${prev.y}, ${cpX} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    // Create area path (for gradient fill)
    const areaD = pathD + ` L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

    return {
      path: pathD,
      areaPath: areaD,
      lastPoint: points[points.length - 1],
      isUp: data[data.length - 1] >= data[0],
    };
  }, [data, width, height]);

  const lineColor = color || (isUp ? '#22c55e' : '#ef4444');
  const gradientId = `sparkline-gradient-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={gradientFrom || lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={gradientTo || lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      
      {/* Gradient fill area */}
      <path
        d={areaPath}
        fill={`url(#${gradientId})`}
      />
      
      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      
      {/* End dot */}
      {showDot && lastPoint.x > 0 && (
        <>
          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r="3"
            fill={lineColor}
            className="motion-safe:animate-pulse"
          />
          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r="1.5"
            fill="white"
          />
        </>
      )}
    </svg>
  );
};

// Generate fake stock data for demo
export function generateSparklineData(length: number = 20, volatility: number = 0.02): number[] {
  const data: number[] = [100];
  for (let i = 1; i < length; i++) {
    const change = (Math.random() - 0.5) * volatility * data[i - 1];
    data.push(Math.max(1, data[i - 1] + change));
  }
  return data;
}
