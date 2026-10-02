import { useState, type ReactNode } from "react";
import { ChatDisclosure } from "../chat/ChatDisclosure.tsx";

/** The same quiet disclosure and inset frame used by Work in the conversation. */
export function WorkDisclosure({
  title,
  children,
  defaultOpen = false,
  className = "",
  label,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <ChatDisclosure
      label={title}
      triggerLabel={label}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      frame={false}
      className={className}
    >
      {children}
    </ChatDisclosure>
  );
}
