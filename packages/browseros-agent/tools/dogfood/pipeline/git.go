package pipeline

import "strings"

type Runner interface {
	Run(dir string, args ...string) error
	OutputRun(dir string, args ...string) (string, error)
}

func Dirty(repoPath string, r Runner) (bool, error) {
	out, err := r.OutputRun(repoPath, "git", "status", "--porcelain")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) != "", nil
}

func Pull(repoPath string, r Runner) error {
	return r.Run(repoPath, "git", "pull", "--ff-only")
}

func Head(repoPath string, r Runner) (string, error) {
	out, err := r.OutputRun(repoPath, "git", "rev-parse", "--short", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

func Branch(repoPath string, r Runner) string {
	out, err := r.OutputRun(repoPath, "git", "branch", "--show-current")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}
