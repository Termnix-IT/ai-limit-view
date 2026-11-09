package detect

import "os"

// LimitView fetches one provider per export. Importing the OpenCode console
// cookie is only part of an OpenCode retrieval, never of another provider's.
func limitviewSkipOpenCodeImport() bool {
	selected := os.Getenv("LIMITVIEW_OPENUSAGE_PROVIDER")
	return selected != "" && selected != "opencode"
}
