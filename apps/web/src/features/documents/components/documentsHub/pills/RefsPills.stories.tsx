/**
 * Storybook stories for RefsPills component
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { RefsPills } from "./RefsPills";

const meta: Meta<typeof RefsPills> = {
  title: "DocumentsHub/Pills/RefsPills",
  component: RefsPills,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    onOpenRef: { action: "opened reference" },
  },
};

export default meta;
type Story = StoryObj<typeof RefsPills>;

export const NoReferences: Story = {
  args: {
    refs: undefined,
  },
};

export const EmptyReferences: Story = {
  args: {
    refs: [],
  },
};

export const SingleDocumentRef: Story = {
  args: {
    refs: [{ kind: "document", id: "doc1" }],
    onOpenRef: (kind, id) => console.log("Open ref:", kind, id),
  },
};

export const SingleTaskRef: Story = {
  args: {
    refs: [{ kind: "task", id: "task1" }],
    onOpenRef: (kind, id) => console.log("Open ref:", kind, id),
  },
};

export const SingleEventRef: Story = {
  args: {
    refs: [{ kind: "event", id: "event1" }],
    onOpenRef: (kind, id) => console.log("Open ref:", kind, id),
  },
};

export const MultipleReferences: Story = {
  args: {
    refs: [
      { kind: "document", id: "doc1" },
      { kind: "task", id: "task1" },
      { kind: "event", id: "event1" },
    ],
    onOpenRef: (kind, id) => console.log("Open ref:", kind, id),
  },
};

export const ManyReferences: Story = {
  args: {
    refs: [
      { kind: "document", id: "doc1" },
      { kind: "document", id: "doc2" },
      { kind: "task", id: "task1" },
      { kind: "task", id: "task2" },
      { kind: "event", id: "event1" },
      { kind: "event", id: "event2" },
    ],
    onOpenRef: (kind, id) => console.log("Open ref:", kind, id),
  },
};

export const OverflowReferences: Story = {
  args: {
    refs: Array.from({ length: 10 }, (_, i) => ({
      kind: "document" as const,
      id: `doc${i + 1}`,
    })),
    onOpenRef: (kind, id) => console.log("Open ref:", kind, id),
  },
};

export const Interactive: Story = {
  args: {
    refs: [
      { kind: "document", id: "doc1" },
      { kind: "task", id: "task1" },
      { kind: "event", id: "event1" },
    ],
    onOpenRef: (kind, id) => {
      console.log("Open ref:", kind, id);
      alert(`Opening ${kind}: ${id}`);
    },
  },
};

