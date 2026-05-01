package adapters

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"

	"router/internal/engine"
)

type OpenAICompatibleAdapter struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func NewOpenAICompatibleAdapter(baseURL, apiKey string, client *http.Client) *OpenAICompatibleAdapter {
	if client == nil {
		client = http.DefaultClient
	}
	return &OpenAICompatibleAdapter{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		client:  client,
	}
}

func (a *OpenAICompatibleAdapter) Type() string { return "openai_compatible" }

func (a *OpenAICompatibleAdapter) Capabilities() []string {
	return []string{"chat_completions", "model_selection", "fallback"}
}

func (a *OpenAICompatibleAdapter) SupportsModel(model string) bool { return true }

func (a *OpenAICompatibleAdapter) Send(ctx context.Context, req engine.ProviderRequest) (engine.ProviderResponse, error) {
	url := a.baseURL + "/v1/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(req.Payload))
	if err != nil {
		return engine.ProviderResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+a.apiKey)

	resp, err := a.client.Do(httpReq)
	if err != nil {
		return engine.ProviderResponse{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return engine.ProviderResponse{}, err
	}

	return engine.ProviderResponse{
		ProviderType: a.Type(),
		Body:         body,
		StatusCode:   resp.StatusCode,
	}, nil
}
