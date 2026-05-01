package adapters

import (
	"context"

	"router/internal/engine"
)

type StubAdapter struct {
	providerType string
}

func NewStubAdapter(providerType string) *StubAdapter {
	return &StubAdapter{providerType: providerType}
}

func (a *StubAdapter) Type() string {
	return a.providerType
}

func (a *StubAdapter) Capabilities() []string {
	return []string{"model_selection", "streaming", "fallback", "quota"}
}

func (a *StubAdapter) SupportsModel(model string) bool {
	return true
}

func (a *StubAdapter) Send(ctx context.Context, req engine.ProviderRequest) (engine.ProviderResponse, error) {
	return engine.ProviderResponse{
		ProviderType: a.providerType,
		StatusCode:   501,
		ErrorCode:    "not_implemented",
	}, nil
}
