import { cn } from "@/lib/cn";

export function Badge({
  className,
  tone = "muted",
  ...props
}: React.ComponentProps<"span"> & { tone?: "muted" | "accent" | "long" | "short" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider",
        tone === "muted" && "bg-surface-2 text-muted",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "long" && "bg-long/15 text-long",
        tone === "short" && "bg-short/15 text-short",
        tone === "warn" && "bg-warn/15 text-warn",
        className,
      )}
      {...props}
    />
  );
}
