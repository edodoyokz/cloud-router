package engine

type ProviderStep struct {
	ProviderConnectionID string
	ProviderType         string
	ModelAlias           string
	FallbackMode         string
}

type ResolutionResult struct {
	RequestID    string
	ProviderUsed string
	FallbackHops int
	TotalTokens  int
	Status       string
	ErrorCode    string
}

type Router struct {
	registry *ProviderRegistry
	resolver *Resolver
}

func New() *Router {
	registry := NewProviderRegistry()
	resolver := NewResolver(registry)
	return &Router{registry: registry, resolver: resolver}
}

func (r *Router) RegisterProvider(adapter ProviderAdapter) {
	if r == nil || r.registry == nil {
		return
	}
	r.registry.Register(adapter)
}

func (r *Router) Resolve() ResolutionResult {
	if r == nil || r.resolver == nil {
		return ResolutionResult{Status: "failed", ErrorCode: "router_unavailable"}
	}

	if adapter, ok := r.resolver.Resolve("stub", ""); ok && adapter != nil {
		return ResolutionResult{
			RequestID:    "stub-request-id",
			ProviderUsed: adapter.Type(),
			FallbackHops: 0,
			TotalTokens:  0,
			Status:       "success",
		}
	}

	return ResolutionResult{
		RequestID:    "stub-request-id",
		ProviderUsed: "stub-provider",
		FallbackHops: 0,
		TotalTokens:  0,
		Status:       "success",
	}
}
