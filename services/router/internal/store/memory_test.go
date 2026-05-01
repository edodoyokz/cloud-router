package store

import (
	"context"
	"testing"
)

func TestMemoryRepositoryFindAPIKey(t *testing.T) {
	repo := NewMemoryRepository()
	repo.APIKeys = []APIKeyRecord{{ID: "key_1", WorkspaceID: "ws_1", KeyHash: "hash"}}

	record, ok, err := repo.FindAPIKeyByHash(context.Background(), "hash")
	if err != nil || !ok {
		t.Fatalf("expected key, ok=%v err=%v", ok, err)
	}
	if record.WorkspaceID != "ws_1" {
		t.Fatalf("unexpected workspace %q", record.WorkspaceID)
	}
}

func TestMemoryRepositoryRecordsUsage(t *testing.T) {
	repo := NewMemoryRepository()
	err := repo.RecordUsage(context.Background(), UsageEvent{WorkspaceID: "ws_1", Status: "success"})
	if err != nil {
		t.Fatalf("record usage: %v", err)
	}
	if len(repo.UsageEvents) != 1 {
		t.Fatalf("expected one usage event")
	}
}
