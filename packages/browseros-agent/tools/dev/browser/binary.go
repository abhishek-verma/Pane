package browser

import (
	"fmt"
	"os"
	"path/filepath"
)

const defaultPaneDevRelative = "chromium/src/out/Default_arm64/Pane Dev.app/Contents/MacOS/Pane Dev"

// ResolveBinary returns the Pane/Chromium binary used for local dev.
// Override with PANE_BINARY or BROWSEROS_BINARY.
func ResolveBinary() (string, error) {
	for _, env := range []string{"PANE_BINARY", "BROWSEROS_BINARY"} {
		if path := os.Getenv(env); path != "" {
			if _, err := os.Stat(path); err != nil {
				return "", fmt.Errorf("%s=%q not found: %w", env, path, err)
			}
			return path, nil
		}
	}

	candidates := []string{}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates,
			filepath.Join(home, defaultPaneDevRelative),
			filepath.Join(home, "chromium/src/out/Default/Pane Dev.app/Contents/MacOS/Pane Dev"),
		)
	}
	if out := os.Getenv("CHROMIUM_OUT"); out != "" {
		candidates = append([]string{
			filepath.Join(out, "Pane Dev.app/Contents/MacOS/Pane Dev"),
		}, candidates...)
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	return "", fmt.Errorf(
		"Pane Dev binary not found (set PANE_BINARY). Looked under ~/chromium/src/out/.../Pane Dev.app",
	)
}

// ResolveExtensionDir picks the unpacked extension to load.
func ResolveExtensionDir(root string, preferDevBuild bool) string {
	prod := filepath.Join(root, "apps/app/dist/chrome-mv3")
	dev := filepath.Join(root, "apps/app/dist/chrome-mv3-dev")
	if preferDevBuild {
		if dirExists(dev) {
			return dev
		}
	}
	if dirExists(prod) {
		return prod
	}
	if dirExists(dev) {
		return dev
	}
	return prod
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
