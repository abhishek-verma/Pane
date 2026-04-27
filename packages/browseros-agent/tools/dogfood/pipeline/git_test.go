package pipeline

import "testing"

func TestDirtyStatus(t *testing.T) {
	r := &FakeRunner{Output: map[string]string{
		"git status --porcelain": " M file.go\n",
	}}
	dirty, err := Dirty("/repo", r)
	if err != nil {
		t.Fatal(err)
	}
	if !dirty {
		t.Fatal("expected dirty")
	}
}

func TestPullRunsFastForwardOnly(t *testing.T) {
	r := &FakeRunner{}
	if err := Pull("/repo", r); err != nil {
		t.Fatal(err)
	}
	if got := r.Commands[0]; got != "git pull --ff-only" {
		t.Fatalf("got %q", got)
	}
}

type FakeRunner struct {
	Commands []string
	Output   map[string]string
}

func (f *FakeRunner) Run(dir string, args ...string) error {
	f.Commands = append(f.Commands, join(args))
	return nil
}

func (f *FakeRunner) OutputRun(dir string, args ...string) (string, error) {
	cmd := join(args)
	f.Commands = append(f.Commands, cmd)
	return f.Output[cmd], nil
}

func join(args []string) string {
	out := ""
	for i, arg := range args {
		if i > 0 {
			out += " "
		}
		out += arg
	}
	return out
}
