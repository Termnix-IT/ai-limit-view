package claude_code

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/janekbaraniewski/openusage/internal/core"
)

func TestLimitViewClaudeSkipsConversationScan(t *testing.T) {
	claudeDir := filepath.Join(t.TempDir(), ".claude")
	project := filepath.Join(claudeDir, "projects", "fixture")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "session.jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	acct := core.AccountConfig{
		ID:           "claude",
		Provider:     "claude_code",
		RuntimeHints: map[string]string{"claude_dir": claudeDir},
	}
	for selected, wantScan := range map[string]bool{"claude_code": false, "": true} {
		t.Run(selected, func(t *testing.T) {
			t.Setenv("LIMITVIEW_OPENUSAGE_PROVIDER", selected)
			snap, err := New().Fetch(context.Background(), acct)
			if err != nil {
				t.Fatal(err)
			}
			if _, scanned := snap.Raw["jsonl_files_found"]; scanned != wantScan {
				t.Fatalf("conversation scan = %v, want %v", scanned, wantScan)
			}
		})
	}
}

func TestLimitViewClaudeDoesNotWriteStatuslineCache(t *testing.T) {
	for selected, wantWrite := range map[string]bool{"claude_code": false, "": true} {
		t.Run(selected, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("USERPROFILE", home)
			t.Setenv("HOME", home)
			t.Setenv("LIMITVIEW_OPENUSAGE_PROVIDER", selected)
			used := 42.0
			snap := core.NewUsageSnapshot("claude_code", "claude")
			snap.Metrics["usage_five_hour"] = core.Metric{Used: &used, Unit: "%"}
			cacheFiveHourFromSnapshot(&snap)
			_, err := os.Stat(filepath.Join(home, ".cache", "openusage", "statusline-5h.json"))
			if written := err == nil; written != wantWrite {
				t.Fatalf("statusline cache written = %v, want %v", written, wantWrite)
			}
		})
	}
}
