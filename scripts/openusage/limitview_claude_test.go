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
