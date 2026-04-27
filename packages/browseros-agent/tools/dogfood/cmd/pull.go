package cmd

import (
	"fmt"

	"browseros-dogfood/pipeline"

	"github.com/spf13/cobra"
)

var pullForce bool

func init() {
	pullCmd.Flags().BoolVar(&pullForce, "force", false, "Pull even when the checkout has uncommitted changes")
	rootCmd.AddCommand(pullCmd)
}

var pullCmd = &cobra.Command{
	Use:   "pull",
	Short: "Refresh the configured BrowserOS checkout",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := loadConfig()
		if err != nil {
			return err
		}
		runner := pipeline.ExecRunner{}
		if err := pipeline.WriteProductionEnvFiles(cfg.AgentRoot(), cfg); err != nil {
			return err
		}
		branch := pipeline.Branch(cfg.RepoPath, runner)
		head, _ := pipeline.Head(cfg.RepoPath, runner)
		fmt.Printf("Repo: %s %s %s\n", cfg.RepoPath, branch, head)
		dirty, err := pipeline.Dirty(cfg.RepoPath, runner)
		if err != nil {
			return err
		}
		if dirty && !pullForce {
			return fmt.Errorf("checkout has uncommitted changes; commit/stash them or use --force")
		}
		if err := pipeline.Pull(cfg.RepoPath, runner); err != nil {
			return err
		}
		newHead, _ := pipeline.Head(cfg.RepoPath, runner)
		fmt.Printf("Updated to %s\n", newHead)
		return nil
	},
}
