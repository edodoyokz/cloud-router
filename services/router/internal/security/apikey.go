package security

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
)

func HashAPIKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func VerifyAPIKey(key, expectedHash string) bool {
	actual := HashAPIKey(key)
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expectedHash)) == 1
}

func APIKeyPrefix(key string) string {
	if len(key) <= 10 {
		return key
	}
	return key[:10]
}
