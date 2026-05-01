# Request Flow — NusaNexus Router MVP

## 1. Control Plane Flow

```text
Browser -> Vercel UI -> Supabase
```

### Steps
1. User login di Vercel UI
2. UI fetch user/workspace data dari Supabase
3. User memilih provider dan preset
4. UI menyimpan perubahan ke Supabase
5. UI menampilkan endpoint/API key ke user

---

## 2. Runtime Router Flow

```text
Coding Tool -> VPS Endpoint -> Supabase -> VPS -> Provider
```

### Steps
1. Tool kirim request ke VPS OpenAI-compatible endpoint
2. VPS validasi API key
3. VPS ambil workspace dan preset terkait dari Supabase
4. VPS cek provider yang aktif dan quota metadata
5. VPS pilih provider pertama yang valid
6. VPS translate request jika perlu
7. VPS forward request ke provider
8. VPS terima response
9. VPS update usage event ke Supabase
10. VPS kembalikan response ke tool

---

## 3. Fallback Flow

```text
Primary provider fail -> Secondary -> Backup -> Stop
```

### Steps
1. Request ke provider primary gagal / limit
2. VPS tandai failure sementara
3. VPS lanjut ke step preset berikutnya
4. Jika provider kedua juga gagal, lanjut lagi
5. Kalau semua habis, return error yang jelas ke user

---

## 4. Onboarding Flow

1. Signup/login
2. Create workspace
3. Connect provider pertama
4. Create preset default
5. Generate API key
6. Copy config snippet
7. Test request pertama

---

## 5. Storage Flow

### Supabase stores
- auth identity
- workspace data
- provider metadata
- preset structure
- API key hash
- usage events
- audit trail

### VPS stores
- transient runtime state
- short-lived request context
- optional local cache for live routing

---

## 6. Error Handling Rules

- provider expired -> show reconnect action
- quota exhausted -> trigger fallback
- invalid API key -> return 401 with simple message
- no preset active -> ask user to select default preset
- no provider available -> stop and surface action required
