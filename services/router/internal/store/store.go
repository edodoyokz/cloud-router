package store

import "context"

type APIKeyRecord struct {
	ID          string
	WorkspaceID string
	KeyHash     string
	Revoked     bool
}

type ProviderConnection struct {
	ID                  string         `json:"id"`
	WorkspaceID         string         `json:"workspace_id"`
	ProviderType        string         `json:"provider_type"`
	DisplayName         string         `json:"display_name"`
	AuthMethod          string         `json:"auth_method"`
	ProviderFamily      string         `json:"provider_family"`
	CredentialEncrypted string         `json:"credential_encrypted"`
	Metadata            map[string]any `json:"metadata"`
	Status              string         `json:"status"`
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
	PromptTokens         int
	CompletionTokens     int
	TotalTokens          int
}

type Repository interface {
	FindAPIKeyByHash(ctx context.Context, hash string) (APIKeyRecord, bool, error)
	DefaultPresetSteps(ctx context.Context, workspaceID string) ([]PresetStep, error)
	ProviderConnection(ctx context.Context, workspaceID, providerConnectionID string) (ProviderConnection, bool, error)
	RecordUsage(ctx context.Context, event UsageEvent) error
}
