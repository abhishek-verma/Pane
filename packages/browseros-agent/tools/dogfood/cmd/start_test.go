package cmd

import (
	"reflect"
	"testing"
)

func TestServerCommandDoesNotWatchFiles(t *testing.T) {
	got := serverCommand()
	want := []string{"bun", "--env-file=.env.development", "src/index.ts"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("server command got %#v want %#v", got, want)
	}
}
