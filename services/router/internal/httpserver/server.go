package httpserver

import (
	"encoding/json"
	"net/http"

	"router/internal/contracts"
	"router/internal/engine"
	"router/internal/engine/adapters"
)

type Server struct {
	router *engine.Router
	mux    *http.ServeMux
}

func New() *Server {
	router := engine.New()
	router.RegisterProvider(adapters.NewStubAdapter("codex"))
	router.RegisterProvider(adapters.NewStubAdapter("kimi"))
	router.RegisterProvider(adapters.NewStubAdapter("minimax"))
	router.RegisterProvider(adapters.NewStubAdapter("zai"))
	router.RegisterProvider(adapters.NewStubAdapter("alibaba"))

	s := &Server{
		router: router,
		mux:    http.NewServeMux(),
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
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)

	result := s.router.Resolve()
	_ = json.NewEncoder(w).Encode(contracts.ErrorResponse{
		Error: contracts.ErrorPayload{
			Code:    result.ErrorCode,
			Message: "router stub not implemented yet",
		},
	})
}
