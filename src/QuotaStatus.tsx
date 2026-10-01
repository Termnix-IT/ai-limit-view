import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { providerDetails, providerStatus } from "./limits";
import type { ProviderQuotaState } from "./types";

export function QuotaStatus({ provider, onClick, label, expanded }: {
  provider: ProviderQuotaState | null;
  onClick?: () => void;
  label?: string;
  expanded?: boolean;
}) {
  const state = provider?.status ?? "loading";
  const Icon = state === "ok" ? Check : state === "loading" ? LoaderCircle : TriangleAlert;
  const content = <><Icon size={10} aria-hidden="true" /><span>{providerStatus(provider)}</span></>;
  const title = providerDetails(provider);
  return state === "unavailable" && onClick ? (
    <button type="button" className="quotaBadge" data-state={state} title={title}
      aria-label={label} aria-expanded={expanded} onClick={onClick}>{content}</button>
  ) : (
    <span className="quotaBadge" data-state={state} title={title}>{content}</span>
  );
}
