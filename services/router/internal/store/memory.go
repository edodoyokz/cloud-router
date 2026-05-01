package store

import (
	"context"
	"sort"
)

type MemoryRepository struct {
	APIKeys     []APIKeyRecord
	Steps       []PresetStep
	Providers   []ProviderConnection
	UsageEvents []UsageEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{}
}

func (m *MemoryRepository) FindAPIKeyByHash(ctx context.Context, hash string) (APIKeyRecord, bool, error) {
	for _, key := range m.APIKeys {
		if key.KeyHash == hash && !key.Revoked {
			return key, true, nil
		}
	}
	return APIKeyRecord{}, false, nil
}

// DefaultPresetSteps returns steps sorted by OrderIndex.
// MemoryRepository is a single-workspace in-memory test repository.
func (m *MemoryRepository) DefaultPresetSteps(ctx context.Context, workspaceID string) ([]PresetStep, error) {
	result := append([]PresetStep(nil), m.Steps...)
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].OrderIndex < result[j].OrderIndex
	})
	return result, nil
}

func (m *MemoryRepository) ProviderConnection(ctx context.Context, workspaceID, providerConnectionID string) (ProviderConnection, bool, error) {
	for _, provider := range m.Providers {
		if provider.WorkspaceID == workspaceID && provider.ID == providerConnectionID {
			return provider, true, nil
		}
	}
	return ProviderConnection{}, false, nil
}

func (m *MemoryRepository) RecordUsage(ctx context.Context, event UsageEvent) error {
	m.UsageEvents = append(m.UsageEvents, event)
	return nil
}
