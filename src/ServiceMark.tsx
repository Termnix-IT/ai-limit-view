import { Box } from "lucide-react";

export function ServiceMark({ variant }: { variant: "codex" | "claude" }) {
  if (variant === "codex") return <Box className="serviceMark" size={17} aria-hidden="true" />;
  return (
    <svg className="serviceMark" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <path key={index} d="M12 2.5v6" transform={`rotate(${index * 30} 12 12)`}
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ))}
    </svg>
  );
}
