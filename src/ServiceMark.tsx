import { Box } from "lucide-react";

export function ServiceMark({ variant, mark }: { variant: string; mark?: string }) {
  if (variant === "codex") return <Box className="serviceMark" size={17} aria-hidden="true" />;
  if (variant !== "claude") return <span className="serviceMark serviceMark--letter" aria-hidden="true">{mark ?? variant.slice(0, 1).toUpperCase()}</span>;
  return (
    <svg className="serviceMark" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <path key={index} d="M12 2.5v6" transform={`rotate(${index * 30} 12 12)`}
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ))}
    </svg>
  );
}
