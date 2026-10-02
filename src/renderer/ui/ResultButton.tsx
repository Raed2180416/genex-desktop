import type { ComponentProps } from "react";
import { Button } from "./Button.tsx";

/** Quiet, filled actions beside delivered content. */
export function ResultButton({ className = "", ...props }: ComponentProps<typeof Button>) {
  return <Button {...props} variant="secondary" className={`result-button ${className}`} />;
}
