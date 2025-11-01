package example

import "testing"

func TestNested(t *testing.T) {
	t.Run("level 1", func(t *testing.T) {
		t.Run("level 2", func(t *testing.T) {
			t.Run("level 3", func(t *testing.T) {
				t.Log("deeply nested test")
			})
		})
	})
}

func TestMultipleSubtests(t *testing.T) {
	t.Run("subtest A", func(t *testing.T) {
		t.Log("A")
	})
	t.Run("subtest B", func(t *testing.T) {
		t.Log("B")
	})
	t.Run("subtest C", func(t *testing.T) {
		t.Log("C")
	})
}
