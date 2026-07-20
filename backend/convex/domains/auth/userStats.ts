import { v } from "convex/values";
import { query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../../_generated/dataModel";

/**
 * Get user activity summary for personalized home page
 */
export const getUserActivitySummary = query({
  args: {},
  returns: v.object({
    documentsThisWeek: v.number(),
    documentsThisMonth: v.number(),
    activeTasks: v.number(),
    completedTasksThisWeek: v.number(),
    unreadBriefings: v.number(),
    lastActivityTime: v.optional(v.number()),
    totalDocuments: v.number(),
    totalTasks: v.number(),
    streakDays: v.number(),
    userName: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) {
      // Return default values for anonymous users
      return {
        documentsThisWeek: 0,
        documentsThisMonth: 0,
        activeTasks: 0,
        completedTasksThisWeek: 0,
        unreadBriefings: 0,
        totalDocuments: 0,
        totalTasks: 0,
        streakDays: 0,
      };
    }

    const user = await ctx.db.get(userId) as Doc<"users"> | null;
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Get all documents for this user
    const allDocuments = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .collect();

    const documentsThisWeek = allDocuments.filter(
      (doc) => doc._creationTime >= weekAgo
    ).length;

    const documentsThisMonth = allDocuments.filter(
      (doc) => doc._creationTime >= monthAgo
    ).length;

    // Get all tasks for this user
    const allTasks = await ctx.db
      .query("userEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const activeTasks = allTasks.filter(
      (task) => task.status !== "done"
    ).length;

    const completedTasksThisWeek = allTasks.filter((task) => {
      if (task.status !== "done") return false;
      const timestamp = typeof task.updatedAt === "number"
        ? task.updatedAt
        : task._creationTime;
      return timestamp >= weekAgo;
    }).length;

    // Get unread briefings count
    const briefings = await ctx.db
      .query("dailyBriefMemories")
      .collect();

    const unreadBriefings = briefings.length;

    // Calculate streak days (consecutive days with activity)
    let streakDays = 0;
    const activityDates = new Set<string>();

    allDocuments.forEach(doc => {
      const date = new Date(doc._creationTime).toDateString();
      activityDates.add(date);
    });

    allTasks.forEach(task => {
      const date = new Date(task._creationTime).toDateString();
      activityDates.add(date);
    });

    // Count consecutive days backward from today
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() - i);
      const dateStr = checkDate.toDateString();

      if (activityDates.has(dateStr)) {
        streakDays++;
      } else if (i > 0) {
        // Stop counting if we hit a day with no activity (but allow today to be empty)
        break;
      }
    }

    // Get last activity time
    const lastDocTime = allDocuments.length > 0
      ? Math.max(...allDocuments.map(d => d._creationTime))
      : 0;
    const lastTaskTime = allTasks.length > 0
      ? Math.max(...allTasks.map(t => t._creationTime))
      : 0;
    const lastActivityTime = Math.max(lastDocTime, lastTaskTime) || undefined;

    return {
      documentsThisWeek,
      documentsThisMonth,
      activeTasks,
      completedTasksThisWeek,
      unreadBriefings,
      lastActivityTime,
      totalDocuments: allDocuments.length,
      totalTasks: allTasks.length,
      streakDays,
      userName: user?.name,
    };
  },
});

/**
 * Get time-based greeting message
 */
export const getGreetingMessage = query({
  args: {},
  returns: v.object({
    greeting: v.string(),
    timeOfDay: v.string(),
    emoji: v.string(),
  }),
  handler: async (ctx) => {
    const hour = new Date().getHours();

    let greeting: string;
    let timeOfDay: string;
    let emoji: string;

    if (hour < 6) {
      greeting = "Good night";
      timeOfDay = "late night";
      emoji = "🌙";
    } else if (hour < 12) {
      greeting = "Good morning";
      timeOfDay = "morning";
      emoji = "☀️";
    } else if (hour < 18) {
      greeting = "Good afternoon";
      timeOfDay = "afternoon";
      emoji = "🌤️";
    } else if (hour < 22) {
      greeting = "Good evening";
      timeOfDay = "evening";
      emoji = "🌆";
    } else {
      greeting = "Good evening";
      timeOfDay = "night";
      emoji = "🌃";
    }

    return { greeting, timeOfDay, emoji };
  },
});

/**
 * Get productivity insights for the user
 */
export const getProductivityInsights = query({
  args: {},
  returns: v.array(v.object({
    type: v.string(),
    message: v.string(),
    icon: v.string(),
    priority: v.string(),
  })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) {
      return [];
    }

    const insights: Array<{
      type: string;
      message: string;
      icon: string;
      priority: string;
    }> = [];

    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Get user's tasks
    const tasks = await ctx.db
      .query("userEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Check for overdue tasks
    const overdueTasks = tasks.filter(
      (task) =>
        task.status !== "done" &&
        task.dueDate &&
        task.dueDate < now
    );

    if (overdueTasks.length > 0) {
      insights.push({
        type: "overdue",
        message: `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`,
        icon: "⚠️",
        priority: "high",
      });
    }

    // Check for tasks due today
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const todayEnd = new Date().setHours(23, 59, 59, 999);
    const tasksToday = tasks.filter(
      (task) =>
        task.status !== "done" &&
        task.dueDate &&
        task.dueDate >= todayStart &&
        task.dueDate <= todayEnd
    );

    if (tasksToday.length > 0) {
      insights.push({
        type: "today",
        message: `${tasksToday.length} task${tasksToday.length > 1 ? 's' : ''} due today`,
        icon: "📅",
        priority: "medium",
      });
    }

    // Check productivity this week
    const completedThisWeek = tasks.filter((task) => {
      if (task.status !== "done") return false;
      const timestamp = typeof task.updatedAt === "number"
        ? task.updatedAt
        : task._creationTime;
      return timestamp >= weekAgo;
    }).length;

    if (completedThisWeek >= 10) {
      insights.push({
        type: "achievement",
        message: `Great week! You've completed ${completedThisWeek} tasks`,
        icon: "🎉",
        priority: "low",
      });
    }

    // Check for documents not updated in a while
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .collect();

    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
    const staleDocuments = documents.filter((doc) => {
      const lastTouched = typeof doc.lastModified === "number"
        ? doc.lastModified
        : doc._creationTime;
      return doc._creationTime < twoWeeksAgo && lastTouched < twoWeeksAgo;
    });

    if (staleDocuments.length >= 3) {
      insights.push({
        type: "stale",
        message: `${staleDocuments.length} documents haven't been updated in 2+ weeks`,
        icon: "📝",
        priority: "low",
      });
    }

    return insights;
  },
});
