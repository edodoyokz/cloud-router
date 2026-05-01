package engine

import "context"

type ProviderRequest struct {
	RequestID    string
	ProviderType string
	Model        string
	Payload      []byte
}

type ProviderResponse struct {
	ProviderType string
	Body         []byte
	StatusCode   int
	TokensUsed   int
	ErrorCode    string
}

type ProviderAdapter interface {
	Type() string
	Capabilities() []string
	SupportsModel(model string) bool
	Send(ctx context.Context, req ProviderRequest) (ProviderResponse, error)
}
