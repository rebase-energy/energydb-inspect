import { useEffect, useState } from "react";

/**
 * True on narrow / portrait viewports. Drives the choice between the desktop
 * 3-pane shell and the stacked mobile shell. Updates live on resize / rotate,
 * so the layout flips the moment you cross the breakpoint.
 */
export function useIsMobile(query = "(max-width: 820px)"): boolean {
  const read = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [mobile, setMobile] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return mobile;
}
