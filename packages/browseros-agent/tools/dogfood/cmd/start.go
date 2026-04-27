package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"browseros-dogfood/browser"
	"browseros-dogfood/config"
	"browseros-dogfood/pipeline"
	"browseros-dogfood/proc"
	"browseros-dogfood/profile"

	"github.com/spf13/cobra"
)

var startRefreshProfile bool
var startHeadless bool

const (
	serverLogName   = "server.log"
	chromiumLogName = "chromium.log"
)

func init() {
	startCmd.Flags().BoolVar(&startRefreshProfile, "refresh-profile", false, "Refresh copied BrowserOS profile before launch")
	startCmd.Flags().BoolVar(&startHeadless, "headless", false, "Run BrowserOS headless")
	rootCmd.AddCommand(startCmd)
}

var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start BrowserOS dogfooding environment",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := loadConfig()
		if err != nil {
			return err
		}
		agentRoot := cfg.AgentRoot()
		runner := pipeline.ExecRunner{}
		if dirty, err := pipeline.Dirty(cfg.RepoPath, runner); err == nil && dirty {
			fmt.Fprintln(os.Stderr, "warning: checkout has uncommitted changes; start will use current files")
		}
		if startRefreshProfile || !exists(cfg.DevUserDataDir) {
			if err := profile.Import(profile.ImportConfig{
				SourceUserDataDir: cfg.SourceUserDataDir,
				SourceProfileDir:  cfg.SourceProfileDir,
				DevUserDataDir:    cfg.DevUserDataDir,
				DevProfileDir:     cfg.DevProfileDir,
			}); err != nil {
				return err
			}
		} else if err := profile.CleanupSingletons(cfg.DevUserDataDir); err != nil {
			return err
		}
		if err := pipeline.WriteProductionEnvFiles(agentRoot, cfg); err != nil {
			return err
		}
		resolvedPorts, changed, err := proc.ResolvePorts(cfg.Ports)
		if err != nil {
			return err
		}
		cfg.Ports = resolvedPorts
		if changed {
			path, err := config.Path()
			if err != nil {
				return err
			}
			if err := config.Save(path, cfg); err != nil {
				return err
			}
			proc.LogMsgf(proc.TagInfo, "Busy ports detected; using CDP=%d Server=%d Extension=%d", cfg.Ports.CDP, cfg.Ports.Server, cfg.Ports.Extension)
		} else {
			proc.LogMsgf(proc.TagInfo, "Using ports CDP=%d Server=%d Extension=%d", cfg.Ports.CDP, cfg.Ports.Server, cfg.Ports.Extension)
		}
		if err := pipeline.Build(agentRoot, runner); err != nil {
			return err
		}
		return runEnvironment(cfg, agentRoot)
	},
}

func runEnvironment(cfg config.Config, agentRoot string) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := os.MkdirAll(cfg.LogDir(), 0755); err != nil {
		return err
	}

	var wg sync.WaitGroup
	var managed []*proc.ManagedProc
	managed = append(managed, proc.StartManaged(ctx, &wg, proc.ProcConfig{
		Tag:     proc.TagBrowser,
		Dir:     agentRoot,
		Restart: false,
		LogPath: cfg.LogPath(chromiumLogName),
		Cmd: browser.BuildArgs(browser.ArgsConfig{
			Binary:      cfg.BrowserOSAppPath,
			AgentRoot:   agentRoot,
			UserDataDir: cfg.DevUserDataDir,
			ProfileDir:  cfg.DevProfileDir,
			Ports:       cfg.Ports,
			Headless:    startHeadless,
		}),
	}))
	proc.LogMsg(proc.TagServer, "Waiting for CDP...")
	if browser.WaitForCDP(ctx, cfg.Ports.CDP, 60) {
		proc.LogMsg(proc.TagServer, "CDP ready")
	} else {
		proc.LogMsg(proc.TagServer, proc.WarnColor.Sprint("CDP not available, starting server anyway"))
	}
	env := os.Environ()
	env = append(env,
		"NODE_ENV=development",
		fmt.Sprintf("BROWSEROS_CDP_PORT=%d", cfg.Ports.CDP),
		fmt.Sprintf("BROWSEROS_SERVER_PORT=%d", cfg.Ports.Server),
		fmt.Sprintf("BROWSEROS_EXTENSION_PORT=%d", cfg.Ports.Extension),
		fmt.Sprintf("VITE_BROWSEROS_SERVER_PORT=%d", cfg.Ports.Server),
	)
	serverDir := filepath.Join(agentRoot, "apps/server")
	managed = append(managed, proc.StartManaged(ctx, &wg, proc.ProcConfig{
		Tag:     proc.TagServer,
		Dir:     serverDir,
		Env:     env,
		Restart: true,
		LogPath: cfg.LogPath(serverLogName),
		Cmd:     serverCommand(),
	}))
	printSummary(cfg, agentRoot)

	sigCh := make(chan os.Signal, 2)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)
	<-sigCh
	fmt.Println()
	proc.LogMsg(proc.TagInfo, proc.WarnColor.Sprint("Shutting down (Ctrl+C again to force)..."))
	cancel()
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	go func() {
		select {
		case <-sigCh:
			for _, p := range managed {
				p.ForceKill()
			}
			os.Exit(1)
		case <-done:
		}
	}()
	for _, p := range managed {
		p.Stop()
	}
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		for _, p := range managed {
			p.ForceKill()
		}
	}
	return nil
}

func serverCommand() []string {
	return []string{"bun", "--env-file=.env.development", "src/index.ts"}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func printSummary(cfg config.Config, agentRoot string) {
	fmt.Println()
	proc.LogMsgf(proc.TagInfo, "App: %s", cfg.BrowserOSAppPath)
	proc.LogMsgf(proc.TagInfo, "Repo: %s", cfg.RepoPath)
	proc.LogMsgf(proc.TagInfo, "Agent root: %s", agentRoot)
	proc.LogMsgf(proc.TagInfo, "Profile: %s", cfg.DevUserDataDir)
	proc.LogMsgf(proc.TagInfo, "Logs: %s", cfg.LogDir())
	proc.LogMsgf(proc.TagInfo, "Ports: CDP=%d Server=%d Extension=%d", cfg.Ports.CDP, cfg.Ports.Server, cfg.Ports.Extension)
	fmt.Println()
}
