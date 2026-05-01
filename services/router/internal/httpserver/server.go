package httpserver

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"router/internal/config"
	"router/internal/contracts"
	"router/internal/engine"
	"router/internal/engine/adapters"
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

	s := &Server{
		router: router,
		mux:    http.NewServeMux(),
		repo:   repo,
		cfg:    opts.Config,
		client: client,
	}

	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

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

	writeError(w, http.StatusNotImplemented, contracts.ErrorProviderRequestFailed, "router stub not implemented yet")
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contracts.ErrorResponse{Error: contracts.ErrorPayload{Code: code, Message: message}})
}
