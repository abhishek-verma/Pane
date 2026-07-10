package cmd

import (
	"browseros-cli/output"
	"strings"

	"github.com/spf13/cobra"
)

func init() {
	parent := &cobra.Command{
		Use:         "skills",
		Annotations: map[string]string{"group": "Resources:"},
		Short:       "Manage local Pane skills",
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List active skills",
		Args:  cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			bucket, _ := cmd.Flags().GetString("bucket")
			toolArgs := map[string]any{}
			if bucket != "" {
				toolArgs["bucketId"] = bucket
			}
			c := newClient()
			result, err := c.CallTool("skills_list", toolArgs)
			if err != nil {
				output.Error(err.Error(), 1)
			}
			if jsonOut {
				output.JSON(result)
			} else {
				output.Confirm(result.TextContent())
			}
		},
	}
	listCmd.Flags().String("bucket", "", "Context bucket id")

	installCmd := &cobra.Command{
		Use:   "install <path-or-url>",
		Short: "Install a skill from a local SKILL.md path or https URL",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			bucket, _ := cmd.Flags().GetString("bucket")
			source := args[0]
			toolArgs := map[string]any{
				"__promoted": true,
			}
			if strings.HasPrefix(source, "https://") || strings.HasPrefix(source, "http://") {
				toolArgs["url"] = source
			} else {
				toolArgs["path"] = source
			}
			if bucket != "" {
				toolArgs["bucketId"] = bucket
			}
			c := newClient()
			result, err := c.CallTool("skills_install", toolArgs)
			if err != nil {
				output.Error(err.Error(), 1)
			}
			if jsonOut {
				output.JSON(result)
			} else {
				output.Confirm(result.TextContent())
			}
		},
	}
	installCmd.Flags().String("bucket", "", "Context bucket id")

	archiveCmd := &cobra.Command{
		Use:   "archive <id>",
		Short: "Archive a skill",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			c := newClient()
			result, err := c.CallTool("skills_archive", map[string]any{
				"id":         args[0],
				"__promoted": true,
			})
			if err != nil {
				output.Error(err.Error(), 1)
			}
			if jsonOut {
				output.JSON(result)
			} else {
				output.Confirm(result.TextContent())
			}
		},
	}

	parent.AddCommand(listCmd, installCmd, archiveCmd)
	rootCmd.AddCommand(parent)
}
