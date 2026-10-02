import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createCanvasGesture, useCanvasView } from "../../src/renderer/canvas-view.ts";

/** Real native scheduler functions reject a foreign receiver; StrictMode also disposes before motion. */
async function checkNativeGesture() {
  let paints = 0;
  let commits = 0;
  const view = { current: { k: 1, tx: 0, ty: 0 } };
  const gesture = createCanvasGesture({
    view,
    schedule: requestAnimationFrame,
    cancel: cancelAnimationFrame,
    paint: () => {
      paints++;
    },
    commit: () => {
      commits++;
    },
  });
  gesture.dispose();
  for (let index = 1; index <= 100; index++) gesture.move({ k: 1, tx: index, ty: 0 });
  const during = { paints, commits };
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  const painted = { paints, commits };
  gesture.finish();
  gesture.dispose();
  return { during, painted, finished: { paints, commits }, tx: view.current.tx };
}

function CanvasFixture() {
  const camera = useCanvasView();
  useEffect(() => {
    let active = true;
    void checkNativeGesture().then(
      (result) => {
        if (active) document.body.dataset.result = JSON.stringify(result);
      },
      (error) => {
        document.body.dataset.error = String(error);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <div ref={camera.viewport} style={{ width: 400, height: 300 }} onPointerDown={camera.onBackgroundDown}>
      <div
        ref={camera.layer}
        style={{ transform: `translate(${camera.view.tx}px, ${camera.view.ty}px) scale(${camera.view.k})` }}
      >
        Native canvas scheduler
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("fixture root missing");
createRoot(root, {
  onUncaughtError: (error) => {
    document.body.dataset.error = String(error);
  },
}).render(
  <StrictMode>
    <CanvasFixture />
  </StrictMode>,
);
