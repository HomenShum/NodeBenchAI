/**
 * Storybook stories for DocumentCard component
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocumentCard } from "./DocumentCard";
import type { DocumentCardData } from "../utils/documentHelpers";

const meta: Meta<typeof DocumentCard> = {
  title: "DocumentsHub/Cards/DocumentCard",
  component: DocumentCard,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    onSelect: { action: "selected" },
    onDelete: { action: "deleted" },
    onToggleFavorite: { action: "toggled favorite" },
    onOpenMiniEditor: { action: "opened mini editor" },
    onToggleSelect: { action: "toggled select" },
    onCardMouseClick: { action: "card clicked" },
    onAnalyzeFile: { action: "analyze file" },
  },
};

export default meta;
type Story = StoryObj<typeof DocumentCard>;

const mockTextDocument: DocumentCardData = {
  _id: "doc1" as any,
  title: "Project Proposal",
  contentPreview: "This is a comprehensive project proposal for the new initiative...",
  documentType: "text",
  createdAt: Date.now() - 86400000,
  createdBy: "user1" as any,
  isArchived: false,
  isFavorite: false,
};

const mockFileDocument: DocumentCardData = {
  _id: "doc2" as any,
  title: "Q4 Report.pdf",
  contentPreview: null,
  documentType: "file",
  fileType: "pdf",
  fileName: "Q4_Report.pdf",
  fileId: "file1" as any,
  lastModified: Date.now() - 3600000,
  createdAt: Date.now() - 172800000,
  createdBy: "user2" as any,
  isArchived: false,
  isFavorite: true,
};

const mockTimelineDocument: DocumentCardData = {
  _id: "doc3" as any,
  title: "Product Roadmap 2024",
  contentPreview: "Timeline for product development",
  documentType: "timeline",
  createdAt: Date.now() - 259200000,
  createdBy: "user3" as any,
  isArchived: false,
  isFavorite: false,
  icon: "🗺️",
};

export const TextDocument: Story = {
  args: {
    doc: mockTextDocument,
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const FileDocument: Story = {
  args: {
    doc: mockFileDocument,
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const TimelineDocument: Story = {
  args: {
    doc: mockTimelineDocument,
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const FavoriteDocument: Story = {
  args: {
    doc: { ...mockTextDocument, isFavorite: true },
    onSelect: (id) => console.log("Selected:", id),
    onToggleFavorite: (id) => console.log("Toggled favorite:", id),
  },
};

export const ArchivedDocument: Story = {
  args: {
    doc: { ...mockTextDocument, isArchived: true },
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const WithCoverImage: Story = {
  args: {
    doc: {
      ...mockTextDocument,
      coverImage: "storage123" as any,
    },
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const HybridMode: Story = {
  args: {
    doc: mockTextDocument,
    hybrid: true,
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const Dragging: Story = {
  args: {
    doc: mockTextDocument,
    isDragging: true,
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const Selected: Story = {
  args: {
    doc: mockTextDocument,
    isSelected: true,
    onSelect: (id) => console.log("Selected:", id),
    onToggleSelect: (id) => console.log("Toggled select:", id),
  },
};

export const WithAllActions: Story = {
  args: {
    doc: mockFileDocument,
    onSelect: (id) => console.log("Selected:", id),
    onDelete: (id) => console.log("Deleted:", id),
    onToggleFavorite: (id) => console.log("Toggled favorite:", id),
    onAnalyzeFile: (doc) => console.log("Analyze:", doc),
  },
};

export const OpenOnSingleClick: Story = {
  args: {
    doc: mockTextDocument,
    openOnSingleClick: true,
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const Interactive: Story = {
  args: {
    doc: mockTextDocument,
    onSelect: (id) => console.log("Selected:", id),
    onDelete: (id) => console.log("Deleted:", id),
    onToggleFavorite: (id) => console.log("Toggled favorite:", id),
    onOpenMiniEditor: (id, el) => console.log("Open mini editor:", id, el),
    onToggleSelect: (id) => console.log("Toggled select:", id),
    onCardMouseClick: (id, e) => {
      console.log("Card clicked:", id, e);
      return false;
    },
    onAnalyzeFile: (doc) => console.log("Analyze:", doc),
  },
};

