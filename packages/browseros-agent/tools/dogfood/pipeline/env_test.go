package pipeline

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"browseros-dogfood/config"
)

func TestWriteProductionEnvFiles(t *testing.T) {
	root := t.TempDir()
	cfg := config.Config{
		ProductionEnv: config.ProductionEnv{
			Server: map[string]string{
				"NODE_ENV":  "production",
				"LOG_LEVEL": "debug",
			},
			CLI: map[string]string{
				"R2_BUCKET":        "browseros",
				"R2_UPLOAD_PREFIX": "",
			},
		},
	}
	if err := WriteProductionEnvFiles(root, cfg); err != nil {
		t.Fatal(err)
	}
	assertMode(t, filepath.Join(root, "apps/server/.env.production"), 0600)
	assertMode(t, filepath.Join(root, "apps/cli/.env.production"), 0600)
	assertContains(t, filepath.Join(root, "apps/server/.env.production"), "BROWSEROS_CONFIG_URL=https://llm.browseros.com/api/browseros-server/config\n")
	assertContains(t, filepath.Join(root, "apps/server/.env.production"), "LOG_LEVEL=debug\n")
	assertContains(t, filepath.Join(root, "apps/server/.env.production"), "NODE_ENV=production\n")
	assertContains(t, filepath.Join(root, "apps/cli/.env.production"), "POSTHOG_API_KEY=\n")
	assertContains(t, filepath.Join(root, "apps/cli/.env.production"), "R2_BUCKET=browseros\n")
	assertContains(t, filepath.Join(root, "apps/cli/.env.production"), "R2_UPLOAD_PREFIX=\n")
}

func TestWriteEnvFileQuotesUnsafeValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.production")
	if err := writeEnvFile(path, map[string]string{"TOKEN": "abc=123 with space"}); err != nil {
		t.Fatal(err)
	}
	assertContains(t, path, "TOKEN=\"abc=123 with space\"\n")
}

func TestWriteEnvFileRejectsNewlines(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.production")
	if err := writeEnvFile(path, map[string]string{"TOKEN": "abc\n123"}); err == nil {
		t.Fatal("expected newline value error")
	}
}

func assertContains(t *testing.T, path string, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), want) {
		t.Fatalf("%s missing %q in %q", path, want, string(got))
	}
}

func assertMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("%s mode got %o want %o", path, got, want)
	}
}
