package export

import (
	"testing"

	"github.com/janekbaraniewski/openusage/internal/core"
)

func TestLimitViewProviderFilter(t *testing.T) {
	accounts := []core.AccountConfig{
		{ID: "claude", Provider: "claude_code"},
		{ID: "global", Provider: "zai"},
		{ID: "china", Provider: "zai"},
		{ID: "never-fetch", Provider: "muse_code"},
	}
	for _, selected := range []string{"", "muse_code", "unknown", "zai", "claude_code"} {
		t.Run(selected, func(t *testing.T) {
			t.Setenv("LIMITVIEW_OPENUSAGE_PROVIDER", selected)
			filtered := limitviewProviderAccounts(accounts)
			want := 0
			if selected == "zai" {
				want = 2
			}
			if selected == "claude_code" {
				want = 1
			}
			if len(filtered) != want {
				t.Fatalf("got %d accounts, want %d", len(filtered), want)
			}
			for _, account := range filtered {
				if account.Provider != selected {
					t.Fatal("unselected provider can be fetched")
				}
			}
		})
	}
}
