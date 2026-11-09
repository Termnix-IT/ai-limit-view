package daemon

import "os"

// LimitView starts one export per provider and poll. Keep detection results in
// memory so a single-provider run never rewrites OpenUsage's settings.json.
func limitviewSkipAutoDetectedSave() bool {
	return os.Getenv("LIMITVIEW_OPENUSAGE_PROVIDER") != ""
}
