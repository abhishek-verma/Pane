package cmd

import (
	"browseros-cli/output"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

func init() {
	parent := &cobra.Command{
		Use:         "home",
		Annotations: map[string]string{"group": "Resources:"},
		Short:       "Manage the adaptive home and widgets",
	}

	widgetsCmd := &cobra.Command{
		Use:   "widgets",
		Short: "Manage home widgets",
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List home widgets and available templates",
		Args:  cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			c := newClient()
			result, err := c.CallTool("home_widget_list", map[string]any{})
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

	addCmd := &cobra.Command{
		Use:   "add <title>",
		Short: "Add a home widget from a built-in template",
		Long: `Add a home widget. Use --template to pick a built-in template by id
(run 'pane home widgets list' to see available templates), or use --source
and --action flags for a custom widget.

The CLI is an explicit user action; writes are auto-promoted past the
MCP dry-run gate.`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			templateId, _ := cmd.Flags().GetString("template")
			sourceType, _ := cmd.Flags().GetString("source-type")
			sourceQuery, _ := cmd.Flags().GetString("source-query")
			actionType, _ := cmd.Flags().GetString("action-type")
			actionTarget, _ := cmd.Flags().GetString("action-target")
			bucketId, _ := cmd.Flags().GetString("bucket")
			whyText, _ := cmd.Flags().GetString("why")

			title := args[0]

			source := map[string]any{}
			if templateId != "" {
				source["type"] = "template"
				source["templateId"] = templateId
			} else if sourceType != "" {
				source["type"] = sourceType
				if sourceQuery != "" {
					source["query"] = sourceQuery
				}
			} else {
				output.Error("provide --template <id> or --source-type <type>", 1)
			}
			if bucketId != "" {
				source["bucketId"] = bucketId
			}

			action := map[string]any{}
			if actionType != "" {
				action["type"] = actionType
				action["target"] = actionTarget
			} else if templateId == "" {
				output.Error("provide --action-type and --action-target for custom widgets", 1)
			}

			sourceJSON, _ := json.Marshal(source)
			actionJSON, _ := json.Marshal(action)

			toolArgs := map[string]any{
				"title":      title,
				"source":     json.RawMessage(sourceJSON),
				"action":     json.RawMessage(actionJSON),
				"whyText":    whyText,
				"__promoted": true,
			}

			c := newClient()
			result, err := c.CallTool("home_widget_add", toolArgs)
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
	addCmd.Flags().String("template", "", "Built-in template id (from 'home widgets list')")
	addCmd.Flags().String("source-type", "", "Data source type: tasks|scheduled|capture|graph|skills")
	addCmd.Flags().String("source-query", "", "Optional filter for the source (e.g. 'status:pending')")
	addCmd.Flags().String("action-type", "", "Action type: navigate|chat-prefill|run-skill|open-route")
	addCmd.Flags().String("action-target", "", "Action target (URL, route, or skill id)")
	addCmd.Flags().String("bucket", "", "Scope widget to a context bucket id")
	addCmd.Flags().String("why", "", "Human-readable explanation for the widget")

	removeCmd := &cobra.Command{
		Use:   "remove <widget-id>",
		Short: "Archive (remove) a home widget by id",
		Long:  "Archives the widget with the given id. The widget is moved to archived status and no longer shown on the home.",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			c := newClient()
			result, err := c.CallTool("home_widget_remove", map[string]any{
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

	resetCmd := &cobra.Command{
		Use:   "reset",
		Short: "Reset home to default (archive all custom widgets)",
		Long:  "Archives all user/agent-created widgets and clears home preferences, returning the home to the Phase 5 curated default.",
		Args:  cobra.NoArgs,
		Run: func(cmd *cobra.Command, args []string) {
			confirm, _ := cmd.Flags().GetBool("yes")
			if !confirm {
				fmt.Println("This will archive all custom widgets and reset the home to defaults.")
				fmt.Print("Continue? [y/N] ")
				var resp string
				fmt.Scan(&resp)
				if resp != "y" && resp != "Y" {
					output.Confirm("Aborted.")
					return
				}
			}
			c := newClient()
			_, err := c.PostREST("/scheduler/home/reset", nil)
			if err != nil {
				output.Error(err.Error(), 1)
			}
			output.Confirm("Home reset to defaults.")
		},
	}
	resetCmd.Flags().BoolP("yes", "y", false, "Skip confirmation prompt")

	widgetsCmd.AddCommand(listCmd, addCmd, removeCmd)
	parent.AddCommand(widgetsCmd, resetCmd)
	rootCmd.AddCommand(parent)
}
