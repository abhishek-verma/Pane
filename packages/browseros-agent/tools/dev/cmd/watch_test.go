package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"browseros-dev/proc"
)

func TestWatchModeRejectsManualClawCombination(t *testing.T) {
	oldManual, oldClaw := watchManual, watchClaw
	watchManual = true
	watchClaw = true
	t.Cleanup(func() {
		watchManual = oldManual
		watchClaw = oldClaw
	})

	_, err := watchMode()
	if err == nil {
		t.Fatal("expected incompatible watch flags to return an error")
	}
	if !strings.Contains(err.Error(), "--manual cannot be combined with --claw") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestWatchRunLockModeIsSharedAcrossWatchVariants(t *testing.T) {
	if watchRunLockMode != "watch" {
		t.Fatalf("expected shared watch lock mode, got %q", watchRunLockMode)
	}
}

func TestBuildClawWatchEnvIncludesSelectedPorts(t *testing.T) {
	env := buildClawWatchEnv([]string{"BASE=1"}, proc.Ports{
		CDP:       9012,
		Server:    9123,
		Extension: 9321,
	})

	for _, want := range []string{
		"BASE=1",
		"BROWSEROS_CLAW_SERVER_PORT=9123",
		"BROWSEROS_COCKPIT_CDP_PORT=9012",
		"VITE_BROWSEROS_CLAW_API_URL=http://127.0.0.1:9123/cockpit",
	} {
		if !hasEnvEntry(env, want) {
			t.Fatalf("expected env to contain %q, got %#v", want, env)
		}
	}
}

func TestEnsureLimactlPresentMissingMessage(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	err := ensureLimactlPresent()
	if err == nil {
		t.Fatal("expected missing Lima error")
	}

	msg := err.Error()
	if !strings.Contains(msg, "Lima is not installed.") {
		t.Fatalf("expected missing Lima message, got %q", msg)
	}
	if !strings.Contains(msg, "brew install lima") {
		t.Fatalf("expected brew install hint, got %q", msg)
	}
}

func TestEnsureLimactlPresentFindsPathBinary(t *testing.T) {
	binDir := t.TempDir()
	limactlPath := filepath.Join(binDir, "limactl")
	if err := os.WriteFile(limactlPath, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)

	if err := ensureLimactlPresent(); err != nil {
		t.Fatalf("expected limactl to resolve, got %v", err)
	}
}

func hasEnvEntry(env []string, want string) bool {
	for _, got := range env {
		if got == want {
			return true
		}
	}
	return false
}
