package profile

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestImportCopiesAllowlistAndLocalState(t *testing.T) {
	root := t.TempDir()
	sourceUser := filepath.Join(root, "source")
	sourceProfile := filepath.Join(sourceUser, "Profile 25")
	devUser := filepath.Join(root, "dev")
	mustWrite(t, filepath.Join(sourceUser, "Local State"), `{
	  "os_crypt": {"encrypted_key": "abc"},
	  "profile": {
	    "info_cache": {
	      "Default": {"name": "Personal", "user_name": "me@example.com"},
	      "Profile 25": {"name": "Sam", "user_name": "sam@example.test"}
	    },
	    "last_used": "Default",
	    "last_active_profiles": ["Default", "Profile 25"],
	    "profiles_order": ["Default", "Profile 25"],
	    "show_picker_on_startup": true,
	    "picker_shown": true
	  }
	}`)
	mustWrite(t, filepath.Join(sourceProfile, "Bookmarks"), "bookmarks")
	mustWrite(t, filepath.Join(sourceProfile, "Preferences"), `{"profile":{"exit_type":"Crashed","exited_cleanly":false}}`)
	mustWrite(t, filepath.Join(sourceProfile, "Cache/junk"), "cache")
	mustWrite(t, filepath.Join(sourceProfile, "Extensions/ext/manifest.json"), "{}")

	err := Import(ImportConfig{
		SourceUserDataDir: sourceUser,
		SourceProfileDir:  "Profile 25",
		DevUserDataDir:    devUser,
		DevProfileDir:     "Default",
	})
	if err != nil {
		t.Fatal(err)
	}

	assertImportedLocalState(t, filepath.Join(devUser, "Local State"))
	assertFile(t, filepath.Join(devUser, "Default", "Bookmarks"), "bookmarks")
	assertMissing(t, filepath.Join(devUser, "Default", "Cache"))
	assertFileExists(t, filepath.Join(devUser, "Default", "Extensions/ext/manifest.json"))
	prefs, err := os.ReadFile(filepath.Join(devUser, "Default", "Preferences"))
	if err != nil {
		t.Fatal(err)
	}
	if string(prefs) != `{"profile":{"exit_type":"Normal","exited_cleanly":true}}` {
		t.Fatalf("preferences not patched: %s", string(prefs))
	}
}

func TestImportRejectsDangerousDevDir(t *testing.T) {
	root := t.TempDir()
	err := Import(ImportConfig{
		SourceUserDataDir: root,
		SourceProfileDir:  "Default",
		DevUserDataDir:    filepath.Join(root, "child"),
		DevProfileDir:     "Default",
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func assertImportedLocalState(t *testing.T, path string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]any
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	osCrypt := state["os_crypt"].(map[string]any)
	if osCrypt["encrypted_key"] != "abc" {
		t.Fatalf("os_crypt not preserved: %#v", osCrypt)
	}
	profile := state["profile"].(map[string]any)
	infoCache := profile["info_cache"].(map[string]any)
	if len(infoCache) != 1 {
		t.Fatalf("expected one dev profile in info_cache, got %#v", infoCache)
	}
	selected := infoCache["Default"].(map[string]any)
	if selected["name"] != "Sam" || selected["user_name"] != "sam@example.test" {
		t.Fatalf("selected profile metadata not remapped: %#v", selected)
	}
	if profile["last_used"] != "Default" {
		t.Fatalf("last_used mismatch: %#v", profile["last_used"])
	}
	assertStringList(t, profile["last_active_profiles"], []string{"Default"})
	assertStringList(t, profile["profiles_order"], []string{"Default"})
	if profile["show_picker_on_startup"] != false {
		t.Fatalf("profile picker not disabled: %#v", profile["show_picker_on_startup"])
	}
}

func TestCleanupSingletons(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "SingletonLock"), "lock")
	mustWrite(t, filepath.Join(dir, "SingletonCookie"), "cookie")
	if err := CleanupSingletons(dir); err != nil {
		t.Fatal(err)
	}
	assertMissing(t, filepath.Join(dir, "SingletonLock"))
	assertMissing(t, filepath.Join(dir, "SingletonCookie"))
}

func assertStringList(t *testing.T, got any, want []string) {
	t.Helper()
	values, ok := got.([]any)
	if !ok {
		t.Fatalf("got %#v, want string list", got)
	}
	if len(values) != len(want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
	for i, value := range values {
		if value != want[i] {
			t.Fatalf("got %#v, want %#v", got, want)
		}
	}
}

func mustWrite(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func assertFile(t *testing.T, path string, want string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != want {
		t.Fatalf("%s got %q want %q", path, string(data), want)
	}
}

func assertFileExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected %s: %v", path, err)
	}
}

func assertMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected missing %s, err=%v", path, err)
	}
}
