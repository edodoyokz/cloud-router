# Streaming — 9router Cloud

## Overview

9router Cloud mendukung streaming responses (SSE — Server-Sent Events) untuk OpenAI-compatible endpoint. Dokumen ini menjelaskan bagaimana streaming dihandle dari coding tool sampai provider dan kembali.

---

## End-to-End Flow

```text
Coding Tool ──SSE──> VPS Router ──SSE──> Provider API
                                              │
Coding Tool <──SSE── VPS Router <──SSE── Provider API
```

### Detail Steps

1. Tool kirim request dengan `"stream": true`
2. Router validasi API key dan resolve workspace/preset
3. Router pilih provider (sama seperti non-streaming)
4. Router open connection ke provider dengan streaming enabled
5. Provider mulai stream SSE chunks
6. Router forward setiap chunk ke tool secara real-time
7. Saat stream selesai (`[DONE]`), router log usage

---

## Request Format

```json
{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "hello"}
  ],
  "stream": true
}
```

---

## Response Format (SSE)

Setiap chunk dikirim sebagai SSE event:

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"index":0}]}

data: [DONE]
```

### HTTP Headers (Response)

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Transfer-Encoding: chunked
```

---

## Router Streaming Implementation

### Proxy Strategy: Passthrough

Router bertindak sebagai transparent SSE proxy:

```text
1. Set response headers (text/event-stream, no-cache)
2. Flush headers ke client
3. Read provider SSE stream chunk by chunk
4. For each chunk:
   a. Parse jika perlu (translate format jika provider non-OpenAI)
   b. Write chunk ke client response
   c. Flush immediately
5. On provider stream end:
   a. Write "data: [DONE]\n\n"
   b. Log usage event
   c. Close connection
```

### Go Implementation Pattern

```go
func (s *Server) handleStreamingChat(w http.ResponseWriter, r *http.Request, provider ProviderAdapter) {
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming not supported", http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")
    w.WriteHeader(http.StatusOK)
    flusher.Flush()

    ctx := r.Context()
    stream, err := provider.StreamSend(ctx, req)
    if err != nil {
        // write SSE error event
        return
    }

    for chunk := range stream {
        fmt.Fprintf(w, "data: %s\n\n", chunk)
        flusher.Flush()
    }

    fmt.Fprintf(w, "data: [DONE]\n\n")
    flusher.Flush()
}
```

---

## Fallback During Streaming

### Rules

- Fallback HANYA terjadi **sebelum** streaming dimulai
- Jika provider gagal connect / return error sebelum chunk pertama → fallback ke provider berikutnya
- Jika streaming sudah dimulai (chunk pertama sudah terkirim) dan provider disconnect mid-stream → **error, tidak fallback**

### Rationale

- Mid-stream fallback akan menghasilkan response yang tidak konsisten (partial dari provider A + partial dari provider B)
- Tool coding tidak bisa handle response switch mid-stream
- Lebih baik fail fast dan biarkan user retry

### Mid-Stream Error Response

```
data: {"error":{"code":"stream_interrupted","message":"Provider disconnected during streaming"}}

data: [DONE]
```

---

## Provider Translation (Non-OpenAI Providers)

Beberapa provider (Kimi, MiniMax, ZAI, Alibaba) mungkin punya format SSE yang berbeda.

### Translation Layer

```text
Provider SSE chunk → Adapter translate → OpenAI SSE format → Client
```

### Adapter Responsibility

Setiap provider adapter harus implement:

```go
type StreamingAdapter interface {
    // StreamSend opens streaming connection and returns channel of OpenAI-format chunks
    StreamSend(ctx context.Context, req ProviderRequest) (<-chan []byte, error)
}
```

Adapter bertanggung jawab:
- Translate request ke format provider
- Open streaming connection
- Translate setiap response chunk ke OpenAI SSE format
- Close connection saat selesai atau error

---

## Buffering & Timeout

| Config | Default | Description |
|--------|---------|-------------|
| `REQUEST_TIMEOUT_MS` | 30000 | Timeout keseluruhan (termasuk streaming) |
| Stream idle timeout | 60s | Jika tidak ada chunk dalam 60 detik, close connection |
| Buffer size | 0 (unbuffered) | Chunks langsung di-flush, tidak di-buffer |

### Timeout Handling

```text
1. Request timeout: hard cutoff, close both connections
2. Idle timeout: jika provider tidak kirim chunk > 60s:
   a. Send error event ke client
   b. Close provider connection
   c. Log timeout event
```

---

## Usage Logging for Streaming

Karena token count baru diketahui di akhir stream, usage logging dilakukan saat stream selesai:

```text
1. Accumulate token count dari setiap chunk (jika provider include usage per chunk)
2. Atau: tunggu final chunk yang include total usage
3. Atau: estimate dari total content length
4. Log usage_event ke Supabase setelah [DONE]
```

### Provider Behavior

| Provider | Usage in stream? | Notes |
|----------|-----------------|-------|
| Codex/OpenAI | Yes, final chunk | `usage` field di chunk terakhir |
| Kimi | Varies | Mungkin perlu post-hoc count |
| MiniMax | Varies | Mungkin perlu post-hoc count |
| ZAI | Varies | Mungkin perlu post-hoc count |
| Alibaba | Varies | Mungkin perlu post-hoc count |

---

## Client Compatibility

### Tested Tools (Target)

| Tool | SSE Support | Notes |
|------|-------------|-------|
| Claude Code | Yes | Standard OpenAI SSE |
| Codex | Yes | Standard OpenAI SSE |
| Cursor | Yes | Standard OpenAI SSE |
| Cline | Yes | Standard OpenAI SSE |
| OpenClaw | Yes | Standard OpenAI SSE |

Semua tool di atas expect standard OpenAI SSE format. Router harus memastikan output selalu comply dengan format ini, regardless of upstream provider.
