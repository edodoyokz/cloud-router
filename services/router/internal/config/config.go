package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port               string
	RequestTimeoutMS   int
	MaxFallbackHops    int
	SupabaseURL        string
	SupabaseServiceKey string
	EncryptionKey      string
}

func Load() Config {
	return Config{
		Port:               getString("ROUTER_PORT", "8080"),
		RequestTimeoutMS:   getInt("REQUEST_TIMEOUT_MS", 30000),
		MaxFallbackHops:    getInt("MAX_FALLBACK_HOPS", 3),
		SupabaseURL:        os.Getenv("SUPABASE_URL"),
		SupabaseServiceKey: os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		EncryptionKey:      os.Getenv("ENCRYPTION_KEY"),
	}
}

func getString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
