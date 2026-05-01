package security

import "testing"

func TestEncryptDecryptCredential(t *testing.T) {
	keyHex := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	plaintext := []byte(`{"api_key":"sk-test"}`)

	ciphertext, err := EncryptCredential(keyHex, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if ciphertext == string(plaintext) || ciphertext == "" {
		t.Fatalf("ciphertext should not equal plaintext")
	}

	decrypted, err := DecryptCredential(keyHex, ciphertext)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if string(decrypted) != string(plaintext) {
		t.Fatalf("expected %s, got %s", plaintext, decrypted)
	}
}

func TestEncryptCredentialRejectsInvalidKey(t *testing.T) {
	_, err := EncryptCredential("bad", []byte("secret"))
	if err == nil {
		t.Fatalf("expected invalid key error")
	}
}
