/**
 * Storybook stories for DocumentRow component
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocumentRow } from "./DocumentRow";
import type { DocumentCardData } from "../utils/documentHelpers";

const meta: Meta<typeof DocumentRow> = {
  title: "DocumentsHub/Rows/DocumentRow",
  component: DocumentRow,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  argTypes: {
    onSelect: { action: "selected" },
    onDelete: { action: "deleted" },
    onToggleFavorite: { action: "toggled favorite" },
  },
};

export default meta;
type Story = StoryObj<typeof DocumentRow>;

const mockTextDocument: DocumentCardData = {
  _id: "doc1" as any,
  title: "Project Proposal",
  contentPreview: "This is a comprehensive project proposal...",
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

export const WithIcon: Story = {
  args: {
    doc: { ...mockTextDocument, icon: "📄" },
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const CompactDensity: Story = {
  args: {
    doc: mockTextDocument,
    density: "compact",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const ComfortableDensity: Story = {
  args: {
    doc: mockTextDocument,
    density: "comfortable",
    onSelect: (id) => console.log("Selected:", id),
  },
};

export const Interactive: Story = {
  args: {
    doc: mockTextDocument,
    onSelect: (id) => console.log("Selected:", id),
    onDelete: (id) => console.log("Deleted:", id),
    onToggleFavorite: (id) => console.log("Toggled favorite:", id),
  },
};

