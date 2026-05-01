package main

import (
	"log"
	"net/http"

	"router/internal/config"
	"router/internal/httpserver"
)

func main() {
	cfg := config.Load()
	server := httpserver.NewWithOptions(httpserver.Options{Config: cfg})

	addr := ":" + cfg.Port
	log.Printf("router listening on %s", addr)
	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}
