package store

import "context"

type APIKeyRecord struct {
	ID          string
	WorkspaceID string
	KeyHash     string
	Revoked     bool
}

type ProviderConnection struct {
	ID                  string
	WorkspaceID         string
	ProviderType        string
	DisplayName         string
	AuthMethod          string
	ProviderFamily      string
	CredentialEncrypted string
	Metadata            map[string]any
	Status              string
}

type PresetStep struct {
	ProviderConnectionID string
	ProviderType         string
	ModelAlias           string
	FallbackMode         string
	OrderIndex           int
}

type UsageEvent struct {
	WorkspaceID          string
	ProviderConnectionID string
	APIKeyID             string
	RequestID            string
	ModelRequested       string
	ModelResolved        string
	Status               string
	ErrorCode            string
	TotalTokens          int
}

type Repository interface {
	FindAPIKeyByHash(ctx context.Context, hash string) (APIKeyRecord, bool, error)
	DefaultPresetSteps(ctx context.Context, workspaceID string) ([]PresetStep, error)
	ProviderConnection(ctx context.Context, workspaceID, providerConnectionID string) (ProviderConnection, bool, error)
	RecordUsage(ctx context.Context, event UsageEvent) error
}
