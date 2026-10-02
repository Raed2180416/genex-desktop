/** Source Genex switch, adapted to Studio's existing controlled-value API. */
import { useId, type JSX } from "react";
import { Switch } from "./switch.tsx";
export function Toggle({
  on,
  onChange,
  label,
  ariaLabel,
  disabled,
  size = "md",
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}): JSX.Element {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2">
      <Switch
        id={id}
        checked={on}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel ?? label ?? "Loop"}
      />
      {label && (
        <label
          htmlFor={id}
          className={`${disabled ? "cursor-default opacity-50" : "cursor-pointer"} ${size === "sm" ? "text-xs" : "text-body-sm"} text-ink-2`}
        >
          {label}
        </label>
      )}
    </span>
  );
}
