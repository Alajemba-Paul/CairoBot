import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[opacity,transform,background-color,color,border-color] duration-[var(--motion-quick)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-foreground hover:opacity-90",
        secondary: "bg-surface-2 text-fg border border-border hover:bg-surface",
        ghost: "text-muted hover:text-fg hover:bg-surface-2",
        long: "bg-long/15 text-long border border-long/30 hover:bg-long/25",
        short: "bg-short/15 text-short border border-short/30 hover:bg-short/25",
        danger: "bg-short text-bg hover:opacity-90",
      },
      size: {
        sm: "h-9 px-3 text-xs rounded-sm",
        md: "h-11 px-4 text-sm rounded-md",
        lg: "h-12 px-5 text-sm rounded-md",
        icon: "size-11 rounded-md",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
