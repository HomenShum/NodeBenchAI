import { useState, useEffect, useMemo } from 'react';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type DayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

export interface TimeContext {
  timeOfDay: TimeOfDay;
  dayOfWeek: DayOfWeek;
  isWeekend: boolean;
  isWorkHours: boolean;
  hour: number;
  minute: number;
  greeting: string;
  emoji: string;
}

const DAYS: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function getGreeting(timeOfDay: TimeOfDay): string {
  switch (timeOfDay) {
    case 'morning':
      return 'Good morning';
    case 'afternoon':
      return 'Good afternoon';
    case 'evening':
      return 'Good evening';
    case 'night':
      return 'Good night';
  }
}

function getEmoji(timeOfDay: TimeOfDay): string {
  switch (timeOfDay) {
    case 'morning':
      return '☀️';
    case 'afternoon':
      return '⚡';
    case 'evening':
      return '🌆';
    case 'night':
      return '🌙';
  }
}

/**
 * Hook that provides time-based context for adaptive UI
 * Updates every minute to keep context current
 */
export function useTimeContext(): TimeContext {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Update every minute
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const context = useMemo<TimeContext>(() => {
    const hour = now.getHours();
    const minute = now.getMinutes();
    const day = now.getDay();
    const timeOfDay = getTimeOfDay(hour);
    const dayOfWeek = DAYS[day];
    const isWeekend = day === 0 || day === 6;
    const isWorkHours = hour >= 9 && hour < 17 && !isWeekend;

    return {
      timeOfDay,
      dayOfWeek,
      isWeekend,
      isWorkHours,
      hour,
      minute,
      greeting: getGreeting(timeOfDay),
      emoji: getEmoji(timeOfDay),
    };
  }, [now]);

  return context;
}

/**
 * Get the appropriate widget type based on time context
 */
export function getActiveWidgetType(context: TimeContext): 'morning' | 'afternoon' | 'evening' | 'weekend' {
  if (context.isWeekend) return 'weekend';
  return context.timeOfDay === 'night' ? 'evening' : context.timeOfDay;
}

export default useTimeContext;

