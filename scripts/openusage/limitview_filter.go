package export

import (
	"os"

	"github.com/janekbaraniewski/openusage/internal/core"
)

// LimitView polls one subscription provider at a time. Filter before Fetch,
// retaining OpenUsage's own account discovery and credential handling.
// Missing/unknown selections fail closed, including when started manually.
func limitviewProviderAccounts(accounts []core.AccountConfig) []core.AccountConfig {
	selected := os.Getenv("LIMITVIEW_OPENUSAGE_PROVIDER")
	switch selected {
	case "claude_code", "zai", "kimi_cli", "command_code", "opencode", "antigravity", "copilot", "cursor":
	default:
		return nil
	}
	var filtered []core.AccountConfig
	for _, account := range accounts {
		if account.Provider == selected {
			filtered = append(filtered, account)
		}
	}
	return filtered
}
