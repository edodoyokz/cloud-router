package httpserver

import (
	"net/http/httptest"
	"testing"
)

func TestHealth(t *testing.T) {
	s := New()
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	s.Handler().ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}
