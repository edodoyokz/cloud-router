package engine

import "strings"

type Resolver struct {
	registry *ProviderRegistry
}

func NewResolver(registry *ProviderRegistry) *Resolver {
	return &Resolver{registry: registry}
}

func (r *Resolver) Resolve(providerType string, model string) (ProviderAdapter, bool) {
	if r == nil || r.registry == nil {
		return nil, false
	}

	adapter, ok := r.registry.Get(providerType)
	if !ok {
		return nil, false
	}

	if model != "" && !adapter.SupportsModel(model) {
		return nil, false
	}

	if strings.TrimSpace(adapter.Type()) == "" {
		return nil, false
	}

	return adapter, true
}
