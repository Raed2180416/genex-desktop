import { useRef, type JSX } from "react";
import { DialogSurface } from "./dialog.tsx";
import { Button } from "./Button.tsx";
export interface ConfirmChoice {
  label: string;
  detail?: string;
  danger?: boolean;
  onChoose: () => void;
}
/** A choice's look: danger reads as destructive, the first (safe) choice as the default. */
function choiceVariant(danger: boolean | undefined, first: boolean): "destructive" | "default" | "secondary" {
  if (danger) return "destructive";
  return first ? "default" : "secondary";
}

/** The safe choice receives initial focus; dismissal preserves the current run. */
export function ConfirmSheet({
  title,
  body,
  choices,
  onDismiss,
  testId,
}: {
  title: string;
  body: string;
  choices: ConfirmChoice[];
  onDismiss: () => void;
  testId?: string;
}): JSX.Element {
  const safe = useRef<HTMLButtonElement>(null);
  return (
    <DialogSurface
      title={title}
      description={body}
      onDismiss={onDismiss}
      testId={testId}
      initialFocus={safe}
      showClose={false}
    >
      <div className="flex flex-col gap-2">
        {choices.map((choice, index) => (
          <Button
            key={choice.label}
            ref={index === 0 ? safe : undefined}
            variant={choiceVariant(choice.danger, index === 0)}
            onClick={choice.onChoose}
            className="h-auto min-h-8 flex-col items-start gap-1 whitespace-normal py-2.5 text-left"
          >
            <span>{choice.label}</span>
            {choice.detail && <span className="font-sans text-dialog-sub opacity-80">{choice.detail}</span>}
          </Button>
        ))}
      </div>
    </DialogSurface>
  );
}
