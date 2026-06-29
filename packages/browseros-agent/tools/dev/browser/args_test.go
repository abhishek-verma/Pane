package browser

import (
	"strings"
	"testing"

	"browseros-dev/proc"
)

func TestBuildArgsUsesDevDockIconAndDisablesBundledExtensions(t *testing.T) {
	args, err := BuildArgs(ArgsConfig{
		Root:              "/repo/packages/browseros-agent",
		Ports:             proc.Ports{CDP: 9005, Server: 9105, Extension: 9305},
		UserDataDir:       "/tmp/browseros-dev",
		LoadDevExtensions: true,
	})
	if err != nil {
		t.Fatalf("BuildArgs: %v", err)
	}
	joined := strings.Join(args, "\n")
	if !strings.Contains(joined, "--browseros-dock-icon=dev") {
		t.Fatalf("missing dev dock icon arg in\n%s", joined)
	}
	if !strings.Contains(joined, "--disable-browseros-extensions") {
		t.Fatalf("missing disable bundled extensions arg in\n%s", joined)
	}
	if !strings.Contains(joined, "--load-extension=") {
		t.Fatalf("missing load-extension arg in\n%s", joined)
	}
}
