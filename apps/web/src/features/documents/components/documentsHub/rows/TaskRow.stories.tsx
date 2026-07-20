/**
 * Storybook stories for TaskRow component
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskRowGlobal } from "./TaskRow";

const meta: Meta<typeof TaskRowGlobal> = {
  title: "DocumentsHub/Rows/TaskRow",
  component: TaskRowGlobal,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  argTypes: {
    onSelect: { action: "selected" },
    onChangeStatus: { action: "status changed" },
    onOpenRef: { action: "opened reference" },
  },
};

export default meta;
type Story = StoryObj<typeof TaskRowGlobal>;

const mockTask = {
  _id: "task1" as any,
  title: "Complete project proposal",
  status: "todo",
  priority: "high",
  dueDate: Date.now() + 86400000,
  isFavorite: false,
  refs: [
    { kind: "document" as const, id: "doc1" },
    { kind: "task" as const, id: "task2" },
  ],
};

const mockEvent = {
  _id: "event1" as any,
  title: "Team Meeting",
  status: "confirmed",
  startTime: Date.now() + 3600000,
  endTime: Date.now() + 7200000,
  allDay: false,
  location: "Conference Room A",
};

export const TodoTask: Story = {
  args: {
    t: mockTask,
    kind: "task",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const InProgressTask: Story = {
  args: {
    t: { ...mockTask, status: "in_progress" },
    kind: "task",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const DoneTask: Story = {
  args: {
    t: { ...mockTask, status: "done" },
    kind: "task",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const BlockedTask: Story = {
  args: {
    t: { ...mockTask, status: "blocked" },
    kind: "task",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const FavoriteTask: Story = {
  args: {
    t: { ...mockTask, isFavorite: true },
    kind: "task",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const HighPriorityTask: Story = {
  args: {
    t: { ...mockTask, priority: "high" },
    kind: "task",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const UrgentPriorityTask: Story = {
  args: {
    t: { ...mockTask, priority: "urgent" },
    kind: "task",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const TaskWithReferences: Story = {
  args: {
    t: {
      ...mockTask,
      refs: [
        { kind: "document" as const, id: "doc1" },
        { kind: "task" as const, id: "task2" },
        { kind: "event" as const, id: "event1" },
      ],
    },
    kind: "task",
    onSelect: (id) => console.log("Selected:", id),
    onOpenRef: (kind, id) => console.log("Open ref:", kind, id),
  },
};

export const ConfirmedEvent: Story = {
  args: {
    t: mockEvent,
    kind: "event",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const TentativeEvent: Story = {
  args: {
    t: { ...mockEvent, status: "tentative" },
    kind: "event",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const CancelledEvent: Story = {
  args: {
    t: { ...mockEvent, status: "cancelled" },
    kind: "event",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const AllDayEvent: Story = {
  args: {
    t: {
      ...mockEvent,
      allDay: true,
      startTime: new Date(2024, 0, 1, 0, 0, 0).getTime(),
      endTime: new Date(2024, 0, 1, 23, 59, 0).getTime(),
    },
    kind: "event",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const CompactDensity: Story = {
  args: {
    t: mockTask,
    kind: "task",
    density: "compact",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const ComfortableDensity: Story = {
  args: {
    t: mockTask,
    kind: "task",
    density: "comfortable",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const Interactive: Story = {
  args: {
    t: mockTask,
    kind: "task",
    onSelect: (id) => console.log("Selected:", id),
    onChangeStatus: (id, status) => console.log("Status changed:", id, status),
    onOpenRef: (kind, id) => console.log("Open ref:", kind, id),
  },
};

