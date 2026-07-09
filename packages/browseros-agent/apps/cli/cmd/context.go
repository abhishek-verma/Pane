package cmd

import (
	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	parent := &cobra.Command{
		Use:         "context",
		Annotations: map[string]string{"group": "Resources:"},
		Short:       "Query the local context graph",
	}

	searchCmd := &cobra.Command{
		Use:   "search <query>",
		Short: "Search context graph snippets",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			limit, _ := cmd.Flags().GetInt("limit")
			bucket, _ := cmd.Flags().GetString("bucket")
			toolArgs := map[string]any{"query": args[0]}
			if limit > 0 {
				toolArgs["limit"] = limit
			}
			if bucket != "" {
				toolArgs["bucketId"] = bucket
			}
			c := newClient()
			result, err := c.CallTool("context_search", toolArgs)
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
	searchCmd.Flags().Int("limit", 8, "Max snippets")
	searchCmd.Flags().String("bucket", "", "Bucket id (default: default)")

	currentCmd := &cobra.Command{
		Use:     "current",
		Aliases: []string{"work"},
		Short:   "Show current work summary",
		Args:    cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			bucket, _ := cmd.Flags().GetString("bucket")
			toolArgs := map[string]any{}
			if bucket != "" {
				toolArgs["bucketId"] = bucket
			}
			c := newClient()
			result, err := c.CallTool("context_current_work", toolArgs)
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
	currentCmd.Flags().String("bucket", "", "Bucket id (default: default)")

	parent.AddCommand(searchCmd, currentCmd)
	rootCmd.AddCommand(parent)
}
