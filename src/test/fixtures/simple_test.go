package example

import "testing"

func TestSimple(t *testing.T) {
	if 1+1 != 2 {
		t.Error("math is broken")
	}
}

func TestAnother(t *testing.T) {
	t.Log("another test")
}
