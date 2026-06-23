import type { MouseEvent as ReactMouseEvent } from "react";

// Shared resize-gutter drag: while dragging it disables text selection and sets the
// body cursor, forwards each mousemove to `onMove`, and cleans up on mouse-up. The
// caller supplies the per-gutter clamp logic in `onMove` (axis only picks the cursor).
export function gutterDrag(e: ReactMouseEvent, axis: "x" | "y", onMove: (ev: MouseEvent) => void): void {
  e.preventDefault();
  const up = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", up);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };
  document.body.style.userSelect = "none";
  document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", up);
}
