package cmd

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"browseros-dogfood/config"
	"browseros-dogfood/pipeline"
	"browseros-dogfood/profile"

	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(initCmd)
}

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Create or update browseros-dogfood config",
	RunE: func(cmd *cobra.Command, args []string) error {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		cfg := config.Defaults(home)
		if cwd, err := os.Getwd(); err == nil && looksLikeRepo(cwd) {
			cfg.RepoPath = cwd
		}
		reader := bufio.NewReader(os.Stdin)
		cfg.RepoPath = prompt(reader, "Repo path", cfg.RepoPath)
		cfg.BrowserOSAppPath = prompt(reader, "BrowserOS binary", cfg.BrowserOSAppPath)
		profiles, _ := profile.ReadProfiles(cfg.SourceUserDataDir)
		cfg.SourceProfileDir = chooseProfile(reader, profiles)
		cfg.Resolve()
		if err := cfg.Validate(); err != nil {
			return err
		}
		path, err := config.Path()
		if err != nil {
			return err
		}
		if err := config.Save(path, cfg); err != nil {
			return err
		}
		if err := pipeline.WriteProductionEnvFiles(cfg.AgentRoot(), cfg); err != nil {
			return err
		}
		fmt.Printf("Config written: %s\nRun: browseros-dogfood start\n", path)
		return nil
	},
}

func prompt(r *bufio.Reader, label string, current string) string {
	fmt.Printf("%s [%s]: ", label, current)
	line, _ := r.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		return current
	}
	home, _ := os.UserHomeDir()
	return config.ExpandTilde(line, home)
}

func chooseProfile(r *bufio.Reader, profiles []profile.BrowserProfile) string {
	if len(profiles) == 0 {
		return "Default"
	}
	fmt.Printf("Found %d BrowserOS profiles:\n", len(profiles))
	for i, p := range profiles {
		email := ""
		if p.Email != "" {
			email = " " + p.Email
		}
		fmt.Printf("  %d. %s (%s)%s\n", i+1, p.Name, p.Dir, email)
	}
	for {
		fmt.Print("Select source profile [1]: ")
		line, _ := r.ReadString('\n')
		line = strings.TrimSpace(line)
		if line == "" {
			return profiles[0].Dir
		}
		n, err := strconv.Atoi(line)
		if err == nil && n >= 1 && n <= len(profiles) {
			return profiles[n-1].Dir
		}
		fmt.Println("Choose a listed number.")
	}
}

func looksLikeRepo(path string) bool {
	_, err := os.Stat(filepath.Join(path, "packages/browseros-agent/package.json"))
	return err == nil
}
