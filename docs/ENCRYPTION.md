# Encryption — NusaNexus Router

## Overview

Provider API keys are stored encrypted in the database. Dokumen ini menjelaskan algoritma, key management, dan encrypt/decrypt flow untuk MVP generic OpenAI-compatible API-key provider.

---

## Algoritma

| Property | Value |
|----------|-------|
| Algorithm | AES-256-GCM |
| Key size | 256-bit (32 bytes) |
| Nonce | 12 bytes, random per encryption |
| Auth tag | 16 bytes (built-in GCM) |
| Encoding | Base64 (nonce + ciphertext + tag) |

### Kenapa AES-256-GCM

- Authenticated encryption (confidentiality + integrity)
- Widely supported di Go (`crypto/aes` + `crypto/cipher`) dan Node.js (`crypto`)
- Industry standard untuk credential storage
- Nonce-based, tidak butuh IV management yang kompleks

---

## Encryption Key

### Source

- Disimpan sebagai env var `ENCRYPTION_KEY`
- Format: 64 karakter hex string (= 32 bytes)
- Contoh: `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`

### Generate Key

```bash
# Linux/macOS
openssl rand -hex 32

# Atau via Go
go run -e 'package main; import ("crypto/rand","fmt"); b:=make([]byte,32); rand.Read(b); fmt.Printf("%x\n",b)'
```

### Key Rules

- Hanya boleh ada di router service dan web app server-side
- NEVER commit ke git
- NEVER log ke stdout
- Rotate key = re-encrypt semua credentials di database

---

## Encrypt Flow

### Saat User Connect Provider

```text
1. User submits a provider API key in the dashboard reconnect/connect form
2. Web app server-side terima raw credential
3. Web app encrypt credential:
   a. Parse ENCRYPTION_KEY dari env (hex → bytes)
   b. Generate 12-byte random nonce
   c. AES-256-GCM encrypt plaintext credential
   d. Concatenate: nonce (12) + ciphertext + auth tag (16)
   e. Base64 encode result
4. Simpan base64 string ke provider_connections.credential_encrypted
5. Raw credential NEVER disimpan di mana pun
```

### Pseudocode (Go)

```go
func Encrypt(plaintext []byte, keyHex string) (string, error) {
    key, _ := hex.DecodeString(keyHex)
    block, _ := aes.NewCipher(key)
    gcm, _ := cipher.NewGCM(block)

    nonce := make([]byte, gcm.NonceSize()) // 12 bytes
    io.ReadFull(rand.Reader, nonce)

    ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
    return base64.StdEncoding.EncodeToString(ciphertext), nil
}
```

### Pseudocode (Node.js)

```js
function encrypt(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([nonce, encrypted, tag]).toString('base64');
}
```

---

## Decrypt Flow

### Saat Router Forward Request

```text
1. Router resolve workspace + preset + provider connection
2. Router read provider_connections.credential_encrypted
3. Router decrypt:
   a. Base64 decode → raw bytes
   b. Extract nonce (first 12 bytes)
   c. Extract ciphertext + auth tag (remaining bytes)
   d. AES-256-GCM decrypt with ENCRYPTION_KEY
4. Router pakai decrypted credential untuk authenticate ke provider
5. Decrypted credential ONLY lives in memory, NEVER logged
```

### Pseudocode (Go)

```go
func Decrypt(encoded string, keyHex string) ([]byte, error) {
    key, _ := hex.DecodeString(keyHex)
    data, _ := base64.StdEncoding.DecodeString(encoded)

    block, _ := aes.NewCipher(key)
    gcm, _ := cipher.NewGCM(block)

    nonceSize := gcm.NonceSize()
    nonce, ciphertext := data[:nonceSize], data[nonceSize:]

    return gcm.Open(nil, nonce, ciphertext, nil)
}
```

---

## Credential Payload Format

Credential yang di-encrypt adalah JSON object:

### OpenAI-compatible API-key Provider

```json
{
  "api_key": "sk-xxxxxxxxxxxx"
}
```

Other credential formats, such as provider OAuth tokens or cookie-based credentials, are future extensions and are not part of the MVP runtime path.

---

## Key Rotation

### Procedure

1. Generate new ENCRYPTION_KEY
2. Run migration script:
   - Read all `provider_connections.credential_encrypted`
   - Decrypt with OLD key
   - Re-encrypt with NEW key
   - Update database
3. Update env var di semua services
4. Restart router dan web app
5. Verify: test satu provider connection

### Migration Script Skeleton

```go
func RotateKey(db *sql.DB, oldKeyHex, newKeyHex string) error {
    rows, _ := db.Query("SELECT id, credential_encrypted FROM provider_connections")
    for rows.Next() {
        var id, encrypted string
        rows.Scan(&id, &encrypted)

        plain, _ := Decrypt(encrypted, oldKeyHex)
        reEncrypted, _ := Encrypt(plain, newKeyHex)

        db.Exec("UPDATE provider_connections SET credential_encrypted = $1 WHERE id = $2",
            reEncrypted, id)
    }
    return nil
}
```

---

## Security Rules

- Encryption key NEVER di-log, NEVER di-commit
- Decrypted credentials ONLY in-memory, NEVER persisted in plaintext
- Nonce harus random per encryption (NEVER reuse)
- Jika GCM auth tag verification gagal → treat sebagai tampering, log alert
- Provider credentials di UI hanya tampil status (active/expired), NEVER raw values
- Key rotation harus tested di staging sebelum production
