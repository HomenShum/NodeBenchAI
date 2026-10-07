import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LinkedInPostCard } from "@/features/narrative/components/social/LinkedInPostCard";
import { renderWithRouter } from "./testUtils";

describe("LinkedInPostCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders safely when archived content is missing", () => {
    renderWithRouter(
      <LinkedInPostCard
        content={undefined}
        postType="daily_digest"
        persona="GENERAL"
        dateString="2026-03-07"
        postedAt={Date.now()}
      />,
    );

    expect(screen.getByText("Daily Digest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(screen.queryByText(/min read/i)).not.toBeInTheDocument();
  });

  it("copies normalized content instead of crashing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    renderWithRouter(
      <LinkedInPostCard
        content={null}
        postType="daily_digest"
        persona="GENERAL"
        dateString="2026-03-07"
        postedAt={Date.now()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("");
    });
  });

  it("falls back cleanly when post type and persona are missing", () => {
    renderWithRouter(
      <LinkedInPostCard
        content="Status update"
        postType={undefined}
        persona={undefined}
        dateString="2026-03-07"
        postedAt={Date.now()}
      />,
    );

    expect(screen.getByText("Daily Digest")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
  });
});
