import * as React from "react";

import { cn } from "./cn.ts";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground aria-invalid:border-destructive bg-field flex field-sizing-content min-h-11 w-full rounded-md border px-3.5 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:shadow-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
