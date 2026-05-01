# Error Codes — NusaNexus Router

## Overview

Semua error response menggunakan format standar:

```json
{
  "error": {
    "code": "error_code_here",
    "message": "Human-readable description"
  }
}
```

HTTP status code mengikuti konvensi REST.

---

## Router Data-Plane Errors

### Authentication Errors

| Code | HTTP | Message | Cause |
|------|------|---------|-------|
| `missing_api_key` | 401 | Authorization header is required | Request tanpa header `Authorization` |
| `invalid_api_key` | 401 | Invalid or revoked API key | API key tidak ditemukan atau sudah di-revoke |
| `malformed_api_key` | 401 | API key format is invalid | Format key tidak sesuai (bukan `nnr_*`) |

### Workspace Errors

| Code | HTTP | Message | Cause |
|------|------|---------|-------|
| `workspace_not_found` | 404 | Workspace not found for this API key | API key valid tapi workspace deleted |
| `workspace_suspended` | 403 | Workspace is suspended | Workspace di-suspend (future) |

### Preset Errors

| Code | HTTP | Message | Cause |
|------|------|---------|-------|
| `no_active_preset` | 422 | No active routing preset configured | Tidak ada preset dengan `is_default = true` |
| `preset_empty` | 422 | Preset has no provider steps | Preset ada tapi tidak ada steps |

### Provider Errors

| Code | HTTP | Message | Cause |
|------|------|---------|-------|
| `no_provider_available` | 502 | No providers available for routing | Semua provider connections inactive/error |
| `provider_unavailable` | 502 | All providers failed | Semua provider di fallback chain gagal |
| `provider_timeout` | 504 | Provider request timed out | Provider tidak response dalam `REQUEST_TIMEOUT_MS` |
| `provider_auth_failed` | 502 | Provider authentication failed | Credential expired/invalid |
| `provider_rate_limited` | 429 | Provider rate limit exceeded | Provider return 429 |
| `provider_error` | 502 | Provider returned an error | Provider return 5xx |
| `quota_exhausted` | 429 | Provider quota exhausted | Quota habis berdasarkan `quota_state` |

### Request Errors

| Code | HTTP | Message | Cause |
|------|------|---------|-------|
| `invalid_request` | 400 | Request body is invalid | JSON malformed atau missing required fields |
| `model_not_supported` | 400 | Requested model is not supported | Model alias tidak dikenali |
| `request_too_large` | 413 | Request payload too large | Body melebihi limit |
| `method_not_allowed` | 405 | Only POST is allowed | HTTP method selain POST |

### Streaming Errors

| Code | HTTP/SSE | Message | Cause |
|------|----------|---------|-------|
| `stream_interrupted` | SSE event | Provider disconnected during streaming | Provider putus mid-stream |
| `stream_timeout` | SSE event | No data received within idle timeout | Provider tidak kirim data > 60s |

### Internal Errors

| Code | HTTP | Message | Cause |
|------|------|---------|-------|
| `router_unavailable` | 503 | Router service is unavailable | Internal error, engine fail |
| `internal_error` | 500 | An unexpected error occurred | Catch-all untuk error tak terduga |
| `decryption_failed` | 500 | Failed to decrypt provider credentials | Encryption key mismatch / corrupt data |

---

## Control-Plane Errors

### Authentication

| Code | HTTP | Message | Cause |
|------|------|---------|-------|
| `unauthorized` | 401 | Authentication required | Session expired / tidak ada |
| `forbidden` | 403 | You don't have access to this resource | Bukan member workspace |

### Validation

| Code | HTTP | Message | Cause |
|------|------|---------|-------|
| `validation_error` | 400 | Request validation failed | Field required kosong / format salah |
| `duplicate_provider` | 409 | Provider already connected | Provider type sudah ada di workspace |
| `duplicate_key_name` | 409 | API key name already exists | Nama key duplikat |

### Resource

| Code | HTTP | Message | Cause |
|------|------|---------|-------|
| `not_found` | 404 | Resource not found | ID tidak ditemukan |
| `workspace_required` | 422 | No workspace found, please create one | User belum punya workspace |

---

## Fallback Behavior

Saat fallback terjadi, router mencoba provider berikutnya di preset. Error codes yang memicu fallback:

| Trigger | Action |
|---------|--------|
| `provider_timeout` | Fallback ke next step |
| `provider_auth_failed` | Fallback ke next step, mark provider `error` |
| `provider_rate_limited` | Fallback ke next step |
| `provider_error` (5xx) | Fallback ke next step |
| `quota_exhausted` | Fallback ke next step |

Jika semua steps gagal → return `provider_unavailable` ke client.

---

## Error Response Examples

### Single provider failure (with fallback success)
Response normal (200), tapi `X-9r-Fallback-Hops: 1` header menunjukkan fallback terjadi.

### All providers failed
```json
{
  "error": {
    "code": "provider_unavailable",
    "message": "All providers failed after 3 attempts"
  }
}
```

### Invalid API key
```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "Invalid or revoked API key"
  }
}
```

### Mid-stream error (SSE)
```
data: {"error":{"code":"stream_interrupted","message":"Provider disconnected during streaming"}}

data: [DONE]
```
