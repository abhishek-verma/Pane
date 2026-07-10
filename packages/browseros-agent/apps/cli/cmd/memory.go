package cmd

import (
	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	parent := &cobra.Command{
		Use:         "memory",
		Annotations: map[string]string{"group": "Resources:"},
		Short:       "Manage local Pane memory",
	}

	recallCmd := &cobra.Command{
		Use:   "recall <query>",
		Short: "Recall long-term memory notes",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			bucket, _ := cmd.Flags().GetString("bucket")
			toolArgs := map[string]any{"query": args[0]}
			if bucket != "" {
				toolArgs["bucketId"] = bucket
			}
			c := newClient()
			result, err := c.CallTool("context_recall", toolArgs)
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
	recallCmd.Flags().String("bucket", "", "Context bucket id")

	addCmd := &cobra.Command{
		Use:   "add <content>",
		Short: "Add a memory note",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			bucket, _ := cmd.Flags().GetString("bucket")
			toolArgs := map[string]any{
				"content":    args[0],
				"__promoted": true,
			}
			if bucket != "" {
				toolArgs["bucketId"] = bucket
			}
			c := newClient()
			result, err := c.CallTool("memory_add", toolArgs)
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
	addCmd.Flags().String("bucket", "", "Context bucket id")

	forgetCmd := &cobra.Command{
		Use:   "forget <match>",
		Short: "Forget memory matching a substring",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			bucket, _ := cmd.Flags().GetString("bucket")
			toolArgs := map[string]any{
				"match":      args[0],
				"__promoted": true,
			}
			if bucket != "" {
				toolArgs["bucketId"] = bucket
			}
			c := newClient()
			result, err := c.CallTool("memory_remove", toolArgs)
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
	forgetCmd.Flags().String("bucket", "", "Context bucket id")

	parent.AddCommand(recallCmd, addCmd, forgetCmd)
	rootCmd.AddCommand(parent)
}
