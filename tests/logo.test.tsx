import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Logo, PH7_LOGO_URL } from "@/components/logo";

describe("canonical pH7 logo", () => {
  it("uses the unchanged official online artwork with accessible text and intrinsic dimensions", () => {
    const markup = renderToStaticMarkup(<Logo />);
    expect(markup).toContain(`src="${PH7_LOGO_URL}"`);
    expect(markup).toContain('alt="pH7"');
    expect(markup).toContain('width="104"');
    expect(markup).toContain('height="59"');
    expect(markup).not.toContain("/_next/image");
    expect(markup).not.toContain("<svg");
  });
  it.each([
    "app/page.tsx", "app/integration/page.tsx",
    "components/funnel/friend-funnel.tsx", "components/funnel/local-continuation.tsx",
    "components/portal/portal-dashboard.tsx",
    "components/admin/admin-console.tsx", "components/admin/demo-admin-console.tsx",
  ])("uses the shared component instead of a recreated visual mark in %s", (file) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(source).toContain('import { Logo } from "@/components/logo"');
    expect(source).toContain("<Logo />");
    expect(source).not.toContain("pH<span>7</span>");
    expect(source).not.toContain(PH7_LOGO_URL);
  });
});
