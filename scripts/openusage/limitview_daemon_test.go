package daemon

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/janekbaraniewski/openusage/internal/config"
	"github.com/janekbaraniewski/openusage/internal/core"
)

func TestLimitViewDoesNotPersistAutoDetectedAccounts(t *testing.T) {
	for selected, wantSaved := range map[string]bool{"claude_code": false, "": true} {
		t.Run(selected, func(t *testing.T) {
			home := t.TempDir()
			for _, name := range []string{"APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOME"} {
				t.Setenv(name, home)
			}
			t.Setenv("LIMITVIEW_OPENUSAGE_PROVIDER", selected)
			// A stale saved list differs from this run's detection, so upstream would save it.
			cfg := config.Config{AutoDetect: true, AutoDetectedAccounts: []core.AccountConfig{{ID: "stale", Provider: "zai"}}}
			ResolveAccounts(&cfg)
			_, err := os.Stat(filepath.Join(home, "openusage", "settings.json"))
			if saved := err == nil; saved != wantSaved {
				t.Fatalf("settings.json saved = %v, want %v", saved, wantSaved)
			}
		})
	}
}
