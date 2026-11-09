package kimi_cli

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/janekbaraniewski/openusage/internal/core"
)

func TestLimitViewKimiSkipsSessionScan(t *testing.T) {
	dir := t.TempDir()
	session := filepath.Join(dir, "group", "session")
	if err := os.MkdirAll(session, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(session, "wire.jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A cancelled context makes any real walk fail as soon as it reaches wire.jsonl.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for selected, wantScan := range map[string]bool{"kimi_cli": false, "": true} {
		t.Run(selected, func(t *testing.T) {
			t.Setenv("LIMITVIEW_OPENUSAGE_PROVIDER", selected)
			_, err := limitviewReadAllSessions(ctx, dir, core.AccountConfig{ID: "kimi", Provider: "kimi_cli"})
			if scanned := err != nil; scanned != wantScan {
				t.Fatalf("session scan = %v, want %v", scanned, wantScan)
			}
		})
	}
}
