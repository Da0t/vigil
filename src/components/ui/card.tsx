import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * GlassCard - the core liquid-glass pane used across Vigil.
 * `glow` adds the red accent ring for active surfaces;
 * `alert` adds the critical ring for deny / breach states.
 */
const GlassCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    glow?: boolean;
    alert?: boolean;
    specular?: boolean;
  }
>(({ className, glow, alert, specular = true, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "lg-glass rounded-2xl",
      specular && "lg-specular",
      glow && "lg-glow",
      alert && "lg-glow-alert",
      className
    )}
    {...props}
  />
));
GlassCard.displayName = "GlassCard";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-5", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-base font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

export { GlassCard, CardHeader, CardTitle, CardContent };
