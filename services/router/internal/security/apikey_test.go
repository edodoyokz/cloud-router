package security

import "testing"

func TestHashAndVerifyAPIKey(t *testing.T) {
	key := "nnr_test_123456"
	hash := HashAPIKey(key)
	if hash == "" || hash == key {
		t.Fatalf("expected non-empty hash different from key")
	}
	if !VerifyAPIKey(key, hash) {
		t.Fatalf("expected key to verify")
	}
	if VerifyAPIKey("wrong", hash) {
		t.Fatalf("expected wrong key to fail")
	}
}

func TestAPIKeyPrefix(t *testing.T) {
	prefix := APIKeyPrefix("nnr_abcdef123456")
	if prefix != "nnr_abcdef" {
		t.Fatalf("unexpected prefix %q", prefix)
	}
}
