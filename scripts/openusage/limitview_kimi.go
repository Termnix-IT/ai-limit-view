package kimi_cli

import (
	"context"
	"os"

	"github.com/janekbaraniewski/openusage/internal/core"
)

// LimitView shows only the subscription quota. Each export is a new process,
// so walking every wire.jsonl could spend the Fetch deadline before the quota call.
func limitviewReadAllSessions(ctx context.Context, dir string, acct core.AccountConfig) ([]kimiModelEntry, error) {
	if os.Getenv("LIMITVIEW_OPENUSAGE_PROVIDER") == "kimi_cli" {
		return nil, nil
	}
	return readAllSessions(ctx, dir, readKimiConfigModel(resolveConfigPath(acct)))
}
