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
		Use:         "abort",
		Annotations: map[string]string{"group": "Conflict:"},
		Short:       "Abort conflict resolution and roll the pending files back",
		Args:        cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			ws, err := resolve.FindActive(appState.Registry, appState.CWD)
			if err != nil {
				return err
			}
			if err := engine.Abort(cmd.Context(), ws); err != nil {
				return err
			}
			return renderResult(map[string]any{"workspace": ws.Name, "aborted": true}, func() {
				fmt.Println(ui.Warning(fmt.Sprintf("Aborted conflict resolution for %s", ws.Name)))
			})
		},
	}
	rootCmd.AddCommand(command)
}
