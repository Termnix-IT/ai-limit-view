package detect

import (
	"testing"
	"time"

	"github.com/janekbaraniewski/openusage/internal/browsercookies"
)

func TestLimitViewImportsOpenCodeCookieOnlyForOpenCode(t *testing.T) {
	reader := &browsercookies.FakeReader{Cookies: []browsercookies.Cookie{{
		Name: "auth", Value: "secret", Domain: ".opencode.ai", Source: "firefox",
		Expires: time.Now().Add(24 * time.Hour),
	}}}
	for selected, wantImport := range map[string]bool{"claude_code": false, "kimi_cli": false, "opencode": true, "": true} {
		t.Run(selected, func(t *testing.T) {
			t.Setenv("LIMITVIEW_OPENUSAGE_PROVIDER", selected)
			saved := stubOpenCodeSession(t, nil, reader)
			detectOpenCodeConsoleSession(opencodeResult())
			if _, imported := saved["opencode"]; imported != wantImport {
				t.Fatalf("cookie imported = %v, want %v", imported, wantImport)
			}
		})
	}
}
