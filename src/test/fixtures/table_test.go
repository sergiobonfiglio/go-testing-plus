package example

import "testing"

func TestTableDriven(t *testing.T) {
	tests := []struct {
		name string
		a    int
		b    int
		want int
	}{
		{name: "positive numbers", a: 1, b: 2, want: 3},
		{name: "negative numbers", a: -1, b: -2, want: -3},
		{name: "mixed signs", a: 5, b: -3, want: 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.a + tt.b
			if got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}
}
