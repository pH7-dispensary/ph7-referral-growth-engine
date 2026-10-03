import { afterEach, describe, expect, it, vi } from "vitest";
import { enhanceDisclosure } from "@/lib/portal/disclosure-motion";

function fixture(reduced = false, supported = true) {
  const summary = Object.assign(new EventTarget(), { setAttribute: vi.fn(), focus: vi.fn() });
  let height = 0;
  const animations: Array<{ onfinish: (() => void) | null; cancel: ReturnType<typeof vi.fn> }> = [];
  const panel = {
    style: { height: "", overflow: "" }, inert: false, scrollHeight: 132,
    contains: () => false, setAttribute: vi.fn(), getBoundingClientRect: () => ({ height }),
    animate: supported ? vi.fn(() => {
      const animation = { onfinish: null as (() => void) | null, cancel: vi.fn() };
      animations.push(animation);
      return animation;
    }) : undefined,
  };
  const details = Object.assign(new EventTarget(), { open: false, dataset: {} as Record<string,string>, querySelector: (selector: string) => selector === "summary" ? summary : panel });
  const preference = Object.assign(new EventTarget(), { matches: reduced });
  const browserWindow = new EventTarget();
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", { activeElement: summary });
  const cleanup = enhanceDisclosure(details as unknown as HTMLDetailsElement, preference as unknown as MediaQueryList);
  function click() {
    const event = new Event("click", { cancelable: true });
    summary.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  return { details, summary, panel, preference, animations, browserWindow, cleanup, click, setHeight: (value: number) => { height=value; } };
}
afterEach(() => vi.unstubAllGlobals());

describe("native disclosure motion", () => {
  it("opens and closes with paired timings and restores natural layout", () => {
    const f=fixture();
    // Native closed details can retain the child's measured layout rectangle.
    f.setHeight(132);
    f.click();
    expect(f.details.open).toBe(true);
    expect(f.panel.inert).toBe(false);
    expect(f.panel.animate).toHaveBeenLastCalledWith([{height:"0px"},{height:"132px"}], {duration:180,easing:"cubic-bezier(0.22, 1, 0.36, 1)"});
    f.animations[0].onfinish!();
    expect(f.panel.style.height).toBe("");
    f.setHeight(132);
    f.click();
    expect(f.details.dataset.expanded).toBe("false");
    expect(f.panel.inert).toBe(true);
    expect(f.details.open).toBe(true);
    expect(f.panel.animate).toHaveBeenLastCalledWith([{height:"132px"},{height:"0px"}], {duration:130,easing:"cubic-bezier(0.22, 1, 0.36, 1)"});
    f.animations[1].onfinish!();
    expect(f.details.open).toBe(false);
    expect(f.panel.style.overflow).toBe("");
    f.cleanup();
  });
  it("retargets from the current rendered height and detaches stale completion", () => {
    const f=fixture(); f.click(); f.setHeight(58); f.click();
    expect(f.animations[0].cancel).toHaveBeenCalledOnce();
    expect(f.animations[0].onfinish).toBeNull();
    expect(f.panel.animate).toHaveBeenLastCalledWith([{height:"58px"},{height:"0px"}], expect.objectContaining({duration:130}));
    f.setHeight(27); f.click();
    expect(f.animations[1].onfinish).toBeNull();
    expect(f.panel.animate).toHaveBeenLastCalledWith([{height:"27px"},{height:"132px"}], expect.objectContaining({duration:180}));
    f.animations[2].onfinish!(); expect(f.details.open).toBe(true); f.cleanup();
  });
  it.each([[true,true],[false,false]])("uses immediate native state with reduced motion=%s and WAAPI=%s", (reduced,supported) => {
    const f=fixture(reduced,supported); f.click(); expect(f.details.open).toBe(true); f.click(); expect(f.details.open).toBe(false); expect(f.animations).toHaveLength(0); f.cleanup();
  });
  it("settles to the latest intent if motion preference or viewport changes", () => {
    const f=fixture(); f.click(); f.preference.matches=true; f.preference.dispatchEvent(new Event("change"));
    expect(f.details.open).toBe(true); expect(f.panel.style.height).toBe(""); expect(f.animations[0].onfinish).toBeNull();
    f.preference.matches=false; f.setHeight(132); f.click(); f.browserWindow.dispatchEvent(new Event("resize")); expect(f.details.open).toBe(false); f.cleanup();
  });
  it("cleans up in-flight animation and listeners without leaving clipped content", () => {
    const f=fixture(); f.click(); f.cleanup();
    expect(f.animations[0].cancel).toHaveBeenCalledOnce(); expect(f.panel.style.height).toBe("");
    const event=new Event("click",{cancelable:true}); f.summary.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  });
});
