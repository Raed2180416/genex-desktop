import type { ComponentProps } from "react";
import { Button } from "./Button.tsx";

/** Quiet, filled actions beside delivered content, in the prompt bar's model pill fill. */
export function ResultButton({ className = "", ...props }: ComponentProps<typeof Button>) {
  return <Button {...props} variant="pill" className={`result-button ${className}`} />;
}
