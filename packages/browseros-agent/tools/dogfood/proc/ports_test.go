package proc

import (
	"net"
	"testing"

	"browseros-dogfood/config"
)

func TestResolvePortsIncrementsBusyPort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port
	got, changed, err := ResolvePorts(config.Ports{CDP: port, Server: 9115, Extension: 9315})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed ports")
	}
	if got.CDP == port {
		t.Fatalf("expected CDP port to move off busy port: %+v", got)
	}
}

func TestResolvePortsAvoidsDuplicates(t *testing.T) {
	base := freePort(t)
	got, changed, err := ResolvePorts(config.Ports{CDP: base, Server: base, Extension: base})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed ports")
	}
	if got.CDP == got.Server || got.Server == got.Extension || got.CDP == got.Extension {
		t.Fatalf("ports must be distinct: %+v", got)
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}
