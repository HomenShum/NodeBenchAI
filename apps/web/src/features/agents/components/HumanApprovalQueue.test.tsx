import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const respondMock = vi.fn();
const cancelMock = vi.fn();
let mutationHookCall = 0;

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

import { HumanApprovalQueue } from "./HumanApprovalQueue";

const pendingRequest = {
  _id: "request-1",
  userId: "user-1",
  threadId: "thread-1",
  messageId: "message-1",
  toolCallId: "tool-1",
  question: "Approve the runtime action?",
  status: "pending",
  _creationTime: 1_700_000_000_000,
};

beforeEach(() => {
  mutationHookCall = 0;
  respondMock.mockReset();
  cancelMock.mockReset();
  useQueryMock.mockReset().mockReturnValue([pendingRequest]);
  useMutationMock.mockReset().mockImplementation(() => {
    const implementation = mutationHookCall % 2 === 0 ? respondMock : cancelMock;
    mutationHookCall += 1;
    return implementation;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HumanApprovalQueue failure recovery", () => {
  it("shows a per-request alert and preserves a custom response when saving fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    respondMock
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ success: true });
    render(<HumanApprovalQueue />);

    const input = screen.getByRole("textbox", { name: "Your response" });
    fireEvent.change(input, { target: { value: "Approve with the scoped limit" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The response was not saved. This request is still pending; try again.",
    );
    expect(screen.getByRole("textbox", { name: "Your response" }))
      .toHaveValue("Approve with the scoped limit");
    expect(respondMock).toHaveBeenCalledWith({
      requestId: "request-1",
      response: "Approve with the scoped limit",
    });

    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Your response" })).toHaveValue("");
    expect(respondMock).toHaveBeenCalledTimes(2);
  });

  it("shows a per-request alert when cancellation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    cancelMock
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ success: true });
    render(<HumanApprovalQueue />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The request was not cancelled. It is still pending; try again.",
    );
    expect(cancelMock).toHaveBeenCalledWith({ requestId: "request-1" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(cancelMock).toHaveBeenCalledTimes(2);
  });

  it("clears a custom response only after the backend confirms success", async () => {
    respondMock.mockResolvedValue({ success: true });
    render(<HumanApprovalQueue />);

    const input = screen.getByRole("textbox", { name: "Your response" });
    fireEvent.change(input, { target: { value: "Approved" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));

    await waitFor(() => expect(
      screen.getByRole("textbox", { name: "Your response" }),
    ).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
