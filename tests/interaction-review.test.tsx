import { afterEach, describe, expect, it, vi } from "vitest";
import InteractionReviewPage from "@/app/dev/interaction-review/page";

afterEach(() => vi.unstubAllEnvs());
describe("isolated UI verification fixture", () => {
  it.each(["production","test"])("cannot expose the synthetic action surface in %s", (environment) => {
    vi.stubEnv("NODE_ENV",environment);
    expect(() => InteractionReviewPage()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
