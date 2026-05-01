package store

import "context"

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

func (m *MemoryRepository) DefaultPresetSteps(ctx context.Context, workspaceID string) ([]PresetStep, error) {
	var result []PresetStep
	for _, step := range m.Steps {
		result = append(result, step)
	}
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
