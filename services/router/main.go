package main

import (
	"log"
	"net/http"

	"router/internal/httpserver"
)

func main() {
	server := httpserver.New()

	log.Println("router listening on :8080")
	if err := http.ListenAndServe(":8080", server.Handler()); err != nil {
		log.Fatal(err)
	}
}
