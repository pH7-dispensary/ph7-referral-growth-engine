import { afterEach, describe, expect, it, vi } from "vitest";
import { createActionFeedback } from "@/lib/portal/action-feedback";

afterEach(() => vi.useRealTimers());
describe("in-place share feedback", () => {
  it("confirms immediately and restores the action without making the user wait", () => {
    vi.useFakeTimers(); const update=vi.fn(); const feedback=createActionFeedback(update);
    feedback.confirm(feedback.begin(),"copy","Link copied");
    expect(update).toHaveBeenLastCalledWith("copy","Link copied");
    vi.advanceTimersByTime(2399); expect(update).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1); expect(update).toHaveBeenLastCalledWith(null,null);
  });
  it("ignores stale asynchronous success and errors after a later interaction", () => {
    const update=vi.fn(); const feedback=createActionFeedback(update);
    const first=feedback.begin(), second=feedback.begin();
    expect(feedback.current(first)).toBe(false); feedback.confirm(first,"share","Thanks for sharing"); expect(update).not.toHaveBeenCalled();
    feedback.confirm(second,"copy","Link copied"); expect(update).toHaveBeenCalledOnce(); feedback.dispose();
  });
  it("renews confirmation on repeated actions instead of letting an old timer clear it", () => {
    vi.useFakeTimers(); const update=vi.fn(); const feedback=createActionFeedback(update);
    feedback.confirm(feedback.begin(),"copy","Link copied"); vi.advanceTimersByTime(2200);
    feedback.confirm(feedback.begin(),"copy","Link copied"); vi.advanceTimersByTime(2200);
    expect(update).toHaveBeenLastCalledWith("copy","Link copied"); vi.advanceTimersByTime(200); expect(update).toHaveBeenLastCalledWith(null,null);
  });
  it("cannot publish completion or reset feedback after unmount", () => {
    vi.useFakeTimers(); const update=vi.fn(); const feedback=createActionFeedback(update);
    const id=feedback.begin(); feedback.confirm(id,"share-copy","Link copied"); feedback.dispose();
    feedback.confirm(id,"share","Thanks for sharing"); vi.runAllTimers(); expect(update).toHaveBeenCalledOnce();
  });
});
