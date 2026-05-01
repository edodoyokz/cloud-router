package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("ROUTER_PORT", "")
	t.Setenv("REQUEST_TIMEOUT_MS", "")
	t.Setenv("MAX_FALLBACK_HOPS", "")

	cfg := Load()
	if cfg.Port != "8080" {
		t.Fatalf("expected default port 8080, got %q", cfg.Port)
	}
	if cfg.RequestTimeoutMS != 30000 {
		t.Fatalf("expected default timeout 30000, got %d", cfg.RequestTimeoutMS)
	}
	if cfg.MaxFallbackHops != 3 {
		t.Fatalf("expected default fallback hops 3, got %d", cfg.MaxFallbackHops)
	}
}
