package main

import (
	"log"
	"net/http"

	"router/internal/config"
	"router/internal/httpserver"
	"router/internal/store"
)

func main() {
	cfg := config.Load()
	var repo store.Repository
	if cfg.SupabaseURL != "" && cfg.SupabaseServiceKey != "" {
		repo = store.NewSupabaseRepository(cfg.SupabaseURL, cfg.SupabaseServiceKey, http.DefaultClient)
		log.Println("router using supabase repository")
	} else {
		repo = store.NewMemoryRepository()
		log.Println("router using memory repository")
	}
	server := httpserver.NewWithOptions(httpserver.Options{Config: cfg, Repo: repo, Client: http.DefaultClient})

	addr := ":" + cfg.Port
	log.Printf("router listening on %s", addr)
	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}
