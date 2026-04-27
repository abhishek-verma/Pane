package cmd

import (
	"fmt"

	"github.com/browseros-ai/BrowserOS/packages/browseros/tools/patch/internal/engine"
	"github.com/browseros-ai/BrowserOS/packages/browseros/tools/patch/internal/resolve"
	"github.com/browseros-ai/BrowserOS/packages/browseros/tools/patch/internal/ui"
	"github.com/spf13/cobra"
)

func init() {
	command := &cobra.Command{
		Use:         "skip",
		Annotations: map[string]string{"group": "Conflict:"},
		Short:       "Skip the current conflict and move to the next one",
		Args:        cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			ws, err := resolve.FindActive(appState.Registry, appState.CWD)
			if err != nil {
				return err
			}
			result, err := engine.Skip(cmd.Context(), ws)
			if err != nil {
				return err
			}
			return renderResult(result, func() {
				fmt.Println(ui.Warning(fmt.Sprintf("Skipped current conflict in %s", ws.Name)))
			})
		},
	}
	rootCmd.AddCommand(command)
}
