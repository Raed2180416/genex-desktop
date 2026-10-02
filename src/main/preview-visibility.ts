/** Stage/observer visibility cannot reveal a native view while an HTML modal occludes it. */
export function previewVisibility(apply: (visible: boolean) => void) {
  let requested = true;
  let occluded = false;
  const refresh = () => apply(requested && !occluded);
  return {
    refresh,
    setVisible(visible: boolean) {
      requested = visible;
      refresh();
    },
    setOccluded(hidden: boolean) {
      occluded = hidden;
      refresh();
    },
  };
}
