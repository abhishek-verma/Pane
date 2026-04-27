package cmd

import (
	"fmt"

	"browseros-dogfood/config"
	"browseros-dogfood/profile"

	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(refreshProfileCmd)
}

var refreshProfileCmd = &cobra.Command{
	Use:   "refresh-profile",
	Short: "Copy the configured BrowserOS profile into the browseros-dogfood dev profile",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := loadConfig()
		if err != nil {
			return err
		}
		if err := profile.Import(profile.ImportConfig{
			SourceUserDataDir: cfg.SourceUserDataDir,
			SourceProfileDir:  cfg.SourceProfileDir,
			DevUserDataDir:    cfg.DevUserDataDir,
			DevProfileDir:     cfg.DevProfileDir,
		}); err != nil {
			return err
		}
		fmt.Printf("Profile refreshed: %s\n", cfg.DevUserDataDir)
		return nil
	},
}

func loadConfig() (config.Config, error) {
	cfg, err := loadConfigWithoutValidation()
	if err != nil {
		return config.Config{}, err
	}
	if err := cfg.Validate(); err != nil {
		return config.Config{}, err
	}
	return cfg, nil
}

func loadConfigWithoutValidation() (config.Config, error) {
	path, err := config.Path()
	if err != nil {
		return config.Config{}, err
	}
	cfg, err := config.Load(path)
	if err != nil {
		return config.Config{}, fmt.Errorf("missing config at %s; run browseros-dogfood init: %w", path, err)
	}
	return cfg, nil
}
