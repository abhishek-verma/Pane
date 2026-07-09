package cmd

import (
	"browseros-cli/output"

	"github.com/spf13/cobra"
)

func init() {
	parent := &cobra.Command{
		Use:         "tasks",
		Annotations: map[string]string{"group": "Resources:"},
		Short:       "Manage the local tasks inbox",
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List tasks",
		Args:  cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			status, _ := cmd.Flags().GetString("status")
			bucket, _ := cmd.Flags().GetString("bucket")
			toolArgs := map[string]any{}
			if status != "" {
				toolArgs["status"] = status
			}
			if bucket != "" {
				toolArgs["bucketId"] = bucket
			}
			c := newClient()
			result, err := c.CallTool("tasks_list", toolArgs)
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
	listCmd.Flags().String("status", "", "Filter: inbox|triaged|done|cancelled")
	listCmd.Flags().String("bucket", "", "Bucket id")

	addCmd := &cobra.Command{
		Use:   "add <title>",
		Short: "Add a task to the inbox",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			bucket, _ := cmd.Flags().GetString("bucket")
			// CLI is an explicit user action — promote write-local past the MCP dry-run gate.
			toolArgs := map[string]any{"title": args[0], "__promoted": true}
			if bucket != "" {
				toolArgs["bucketId"] = bucket
			}
			c := newClient()
			result, err := c.CallTool("tasks_add", toolArgs)
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
	addCmd.Flags().String("bucket", "", "Bucket id")

	doneCmd := &cobra.Command{
		Use:   "done <task-id>",
		Short: "Mark a task done",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			c := newClient()
			result, err := c.CallTool("tasks_done", map[string]any{
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

	parent.AddCommand(listCmd, addCmd, doneCmd)
	rootCmd.AddCommand(parent)
}
