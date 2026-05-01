package httpserver

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"router/internal/config"
	"router/internal/contracts"
	"router/internal/engine"
	"router/internal/engine/adapters"
	"router/internal/security"
	"router/internal/store"
)

type Server struct {
	router *engine.Router
	mux    *http.ServeMux
	repo   store.Repository
	cfg    config.Config
	client *http.Client
}

type Options struct {
	Repo   store.Repository
	Config config.Config
	Client *http.Client
}

func New() *Server {
	return NewWithOptions(Options{
		Repo:   store.NewMemoryRepository(),
		Config: config.Load(),
		Client: http.DefaultClient,
	})
}

func NewWithOptions(opts Options) *Server {
	router := engine.New()
	router.RegisterProvider(adapters.NewStubAdapter("codex"))
	router.RegisterProvider(adapters.NewStubAdapter("kimi"))
	router.RegisterProvider(adapters.NewStubAdapter("minimax"))
	router.RegisterProvider(adapters.NewStubAdapter("zai"))
	router.RegisterProvider(adapters.NewStubAdapter("alibaba"))

	repo := opts.Repo
	if repo == nil {
		repo = store.NewMemoryRepository()
	}
	client := opts.Client
	if client == nil {
		client = http.DefaultClient
	}

	s := &Server{router: router, mux: http.NewServeMux(), repo: repo, cfg: opts.Config, client: client}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler { return s.mux }

func (s *Server) routes() {
	s.mux.HandleFunc("/health", s.handleHealth)
	s.mux.HandleFunc("/v1/chat/completions", s.handleChatCompletions)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(contracts.HealthResponse{OK: true})
}

func (s *Server) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, contracts.ErrorInvalidRequest, "method not allowed")
		return
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, contracts.ErrorInvalidRequest, "invalid request body")
		return
	}
	var req contracts.ChatCompletionRequest
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, contracts.ErrorInvalidRequest, "invalid json")
		return
	}
	if req.Stream {
		writeError(w, http.StatusBadRequest, contracts.ErrorUnsupportedStreaming, "streaming is not supported yet")
		return
	}

	modelRequested := req.Model

	rawKey := bearerToken(r.Header.Get("Authorization"))
	if rawKey == "" {
		writeError(w, http.StatusUnauthorized, contracts.ErrorInvalidAPIKey, "invalid api key")
		return
	}
	hash := security.HashAPIKey(rawKey)
	apiKey, ok, err := s.repo.FindAPIKeyByHash(r.Context(), hash)
	if err != nil || !ok {
		writeError(w, http.StatusUnauthorized, contracts.ErrorInvalidAPIKey, "invalid api key")
		return
	}
	steps, err := s.repo.DefaultPresetSteps(r.Context(), apiKey.WorkspaceID)
	if err != nil || len(steps) == 0 {
		s.recordFailureUsage(r, apiKey, store.UsageEvent{
			RequestID:      "req_1",
			ModelRequested: modelRequested,
			ErrorCode:      contracts.ErrorPresetNotFound,
		})
		writeError(w, http.StatusNotFound, contracts.ErrorPresetNotFound, "default preset not found")
		return
	}

	maxAttempts := s.cfg.MaxFallbackHops + 1
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	if maxAttempts > len(steps) {
		maxAttempts = len(steps)
	}

	lastFailureEvent := store.UsageEvent{
		RequestID:      "req_1",
		ModelRequested: modelRequested,
		ErrorCode:      contracts.ErrorFallbackExhausted,
	}

	for attempt := 0; attempt < maxAttempts; attempt++ {
		step := steps[attempt]
		lastFailureEvent.ProviderConnectionID = step.ProviderConnectionID
		provider, ok, err := s.repo.ProviderConnection(r.Context(), apiKey.WorkspaceID, step.ProviderConnectionID)
		if err != nil || !ok {
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: step.ProviderConnectionID,
				RequestID:            "req_1",
				ModelRequested:       modelRequested,
				ErrorCode:            contracts.ErrorProviderNotFound,
			})
			writeError(w, http.StatusNotFound, contracts.ErrorProviderNotFound, "provider not found")
			return
		}
		if provider.ProviderType != "openai_compatible" {
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: provider.ID,
				RequestID:            "req_1",
				ModelRequested:       modelRequested,
				ErrorCode:            contracts.ErrorProviderRequestFailed,
			})
			writeError(w, http.StatusBadGateway, contracts.ErrorProviderRequestFailed, "unsupported provider type")
			return
		}
		baseURL, _ := provider.Metadata["base_url"].(string)
		defaultModel, _ := provider.Metadata["default_model"].(string)
		if baseURL == "" || defaultModel == "" {
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: provider.ID,
				RequestID:            "req_1",
				ModelRequested:       modelRequested,
				ErrorCode:            contracts.ErrorProviderRequestFailed,
			})
			writeError(w, http.StatusBadGateway, contracts.ErrorProviderRequestFailed, "provider metadata invalid")
			return
		}
		decrypted, err := security.DecryptCredential(s.cfg.EncryptionKey, provider.CredentialEncrypted)
		if err != nil {
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: provider.ID,
				RequestID:            "req_1",
				ModelRequested:       modelRequested,
				ErrorCode:            contracts.ErrorProviderCredentialMissing,
			})
			writeError(w, http.StatusBadGateway, contracts.ErrorProviderCredentialMissing, "provider credential missing")
			return
		}
		var cred map[string]any
		if err := json.Unmarshal(decrypted, &cred); err != nil {
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: provider.ID,
				RequestID:            "req_1",
				ModelRequested:       modelRequested,
				ErrorCode:            contracts.ErrorProviderCredentialMissing,
			})
			writeError(w, http.StatusBadGateway, contracts.ErrorProviderCredentialMissing, "provider credential invalid")
			return
		}
		providerAPIKey, _ := cred["api_key"].(string)
		if providerAPIKey == "" {
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: provider.ID,
				RequestID:            "req_1",
				ModelRequested:       modelRequested,
				ErrorCode:            contracts.ErrorProviderCredentialMissing,
			})
			writeError(w, http.StatusBadGateway, contracts.ErrorProviderCredentialMissing, "provider api key missing")
			return
		}

		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			writeError(w, http.StatusBadRequest, contracts.ErrorInvalidRequest, "invalid json")
			return
		}
		requestedModel, _ := body["model"].(string)
		if requestedModel == "" || requestedModel == "auto" {
			body["model"] = defaultModel
		}
		resolvedModel, _ := body["model"].(string)
		lastFailureEvent.ProviderConnectionID = provider.ID
		lastFailureEvent.ModelRequested = requestedModel
		lastFailureEvent.ModelResolved = resolvedModel
		payload, err := json.Marshal(body)
		if err != nil {
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: provider.ID,
				RequestID:            "req_1",
				ModelRequested:       requestedModel,
				ModelResolved:        resolvedModel,
				ErrorCode:            contracts.ErrorInvalidRequest,
			})
			writeError(w, http.StatusBadRequest, contracts.ErrorInvalidRequest, "invalid request payload")
			return
		}

		adapter := adapters.NewOpenAICompatibleAdapter(baseURL, providerAPIKey, s.client)
		resp, err := adapter.Send(r.Context(), engine.ProviderRequest{RequestID: "req_1", ProviderType: provider.ProviderType, Model: resolvedModel, Payload: payload})
		if err != nil {
			if attempt < maxAttempts-1 {
				continue
			}
			s.recordFailureUsage(r, apiKey, lastFailureEvent)
			writeError(w, http.StatusBadGateway, contracts.ErrorFallbackExhausted, "all fallback providers exhausted")
			return
		}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(resp.StatusCode)
			_, _ = w.Write(resp.Body)
			status := "success"
			if attempt > 0 {
				status = "fallback"
			}
			usage := extractTokenUsage(resp.Body)
			_ = s.repo.RecordUsage(r.Context(), store.UsageEvent{
				WorkspaceID:          apiKey.WorkspaceID,
				ProviderConnectionID: provider.ID,
				APIKeyID:             apiKey.ID,
				RequestID:            "req_1",
				ModelRequested:       requestedModel,
				ModelResolved:        resolvedModel,
				Status:               status,
				PromptTokens:         usage.PromptTokens,
				CompletionTokens:     usage.CompletionTokens,
				TotalTokens:          usage.TotalTokens,
			})
			return
		}

		if retryableStatus(resp.StatusCode) {
			continue
		}
		s.recordFailureUsage(r, apiKey, store.UsageEvent{
			ProviderConnectionID: provider.ID,
			RequestID:            "req_1",
			ModelRequested:       requestedModel,
			ModelResolved:        resolvedModel,
			ErrorCode:            contracts.ErrorProviderRequestFailed,
		})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(resp.Body)
		return
	}

		writeError(w, http.StatusBadGateway, contracts.ErrorFallbackExhausted, "all fallback providers exhausted")
	s.recordFailureUsage(r, apiKey, lastFailureEvent)
}

type responseUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

func (s *Server) recordFailureUsage(r *http.Request, apiKey store.APIKeyRecord, event store.UsageEvent) {
	event.WorkspaceID = apiKey.WorkspaceID
	event.APIKeyID = apiKey.ID
	event.Status = "failed"
	event.PromptTokens = 0
	event.CompletionTokens = 0
	event.TotalTokens = 0
	_ = s.repo.RecordUsage(r.Context(), event)
}

func extractTokenUsage(body []byte) responseUsage {
	var payload struct {
		Usage responseUsage `json:"usage"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return responseUsage{}
	}
	usage := payload.Usage
	if usage.TotalTokens == 0 && (usage.PromptTokens > 0 || usage.CompletionTokens > 0) {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	return usage
}

func retryableStatus(status int) bool {
	switch status {
	case 429, 500, 502, 503, 504:
		return true
	default:
		return false
	}
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contracts.ErrorResponse{Error: contracts.ErrorPayload{Code: code, Message: message}})
}
