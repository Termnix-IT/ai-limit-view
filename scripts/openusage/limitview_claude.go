package claude_code

import (
	"os"

	"github.com/janekbaraniewski/openusage/internal/core"
)

// LimitView shows only the usage API windows. Each export is a new process, so
// parsing every session log would spend the Fetch deadline before the API call.
func (p *Provider) limitviewReadConversationJSONL(projectsDir, altProjectsDir string, snap *core.UsageSnapshot) error {
	if os.Getenv("LIMITVIEW_OPENUSAGE_PROVIDER") == "claude_code" {
		return nil
	}
	return p.readConversationJSONL(projectsDir, altProjectsDir, snap)
}
