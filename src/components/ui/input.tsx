import * as React from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-12 w-full rounded-md border border-border bg-surface px-4 font-mono text-sm text-fg placeholder:text-faint",
        "transition-[border-color,box-shadow] duration-[var(--motion-quick)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
