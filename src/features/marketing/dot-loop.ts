/**
 * The one endless loop on the landing page: the data dots (design.md
 * "Landing motion identity" item 3 and "Pausing"). It schedules frames only
 * while the tab is visible and while `onFrame` reports something to draw;
 * `start()` resumes it (on scroll, resize, or the tab becoming visible).
 */
export type DotLoop = { start: () => void; stop: () => void; destroy: () => void };

export function createDotLoop(onFrame: (dtSeconds: number) => boolean): DotLoop {
  let id: number | null = null;
  let last: number | null = null;
  const hidden = () => document.visibilityState === "hidden";

  const tick = (time: number) => {
    id = null;
    // Cap the step so a long pause never makes the dots jump far ahead.
    const dt = last === null ? 0 : Math.min((time - last) / 1000, 0.1);
    last = time;
    const keepGoing = onFrame(dt);
    if (keepGoing && !hidden()) id = window.requestAnimationFrame(tick);
    else last = null;
  };

  const start = () => {
    if (id !== null || hidden()) return;
    id = window.requestAnimationFrame(tick);
  };

  const stop = () => {
    if (id !== null) window.cancelAnimationFrame(id);
    id = null;
    last = null;
  };

  const onVisibility = () => {
    if (hidden()) stop();
    else start();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    start,
    stop,
    destroy: () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
