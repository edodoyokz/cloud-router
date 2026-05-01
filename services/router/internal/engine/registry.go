package engine

import "strings"

type ProviderRegistry struct {
	adapters map[string]ProviderAdapter
}

func NewProviderRegistry() *ProviderRegistry {
	return &ProviderRegistry{adapters: make(map[string]ProviderAdapter)}
}

func (r *ProviderRegistry) Register(adapter ProviderAdapter) {
	if adapter == nil {
		return
	}
	r.adapters[strings.ToLower(adapter.Type())] = adapter
}

func (r *ProviderRegistry) Get(providerType string) (ProviderAdapter, bool) {
	adapter, ok := r.adapters[strings.ToLower(providerType)]
	return adapter, ok
}

func (r *ProviderRegistry) KnownTypes() []string {
	out := make([]string, 0, len(r.adapters))
	for k := range r.adapters {
		out = append(out, k)
	}
	return out
}
