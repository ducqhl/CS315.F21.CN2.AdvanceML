# Authentication Architecture

**Version**: 1.0  
**Last Updated**: 2026-05-24

---

## Overview

Simple single-account JWT authentication with an admin user initialized from environment variables and stored in MongoDB's `users` collection. No user registration — the admin credentials are hardcoded at deployment time.

---

## Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Auth type | JWT (HS256) | Stateless, no session storage needed |
| Password storage | SHA-256 hash | Adequate for single internal admin account |
| Token storage | localStorage | Simple; adequate for internal tool |
| Token expiry | 8 hours | Balance security vs. usability |
| Library | Python stdlib only | No additional deps (hashlib + hmac) |
| User count | 1 (admin) | Per requirements — "single account" |

---

## Credentials

Default credentials (change via environment variables):

```
Username: admin
Password: password123  (set via ADMIN_PASSWORD env var)
```

**Change before production deployment:**
```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong_password_here>
JWT_SECRET_KEY=<random_64_char_string>
```

---

## MongoDB: `users` Collection

Single document initialized on API startup:

```json
{
  "_id": ObjectId,
  "username": "admin",
  "password_hash": "<sha256_hex_of_password>",
  "role": "admin",
  "created_at": "2026-05-24T00:00:00Z"
}
```

**Init logic** (idempotent — runs on every API start):
```python
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password123")

user_doc = {
    "username": ADMIN_USERNAME,
    "password_hash": hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest(),
    "role": "admin",
    "created_at": datetime.now(timezone.utc),
}
db.users.update_one(
    {"username": ADMIN_USERNAME},
    {"$setOnInsert": user_doc},
    upsert=True,
)
```

---

## JWT Implementation (no external deps)

```python
import base64, hashlib, hmac, json
from datetime import datetime, timedelta, timezone

JWT_SECRET = os.environ.get("JWT_SECRET_KEY", "crypto_quantum_terminal_secret_2026")
JWT_EXPIRE_HOURS = 8

def create_token(payload: dict) -> str:
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()
    
    payload["exp"] = (datetime.now(timezone.utc) + 
                      timedelta(hours=JWT_EXPIRE_HOURS)).timestamp()
    body = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).rstrip(b"=").decode()
    
    sig = base64.urlsafe_b64encode(
        hmac.new(JWT_SECRET.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    
    return f"{header}.{body}.{sig}"

def verify_token(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed token")
    
    header, body, sig = parts
    expected = base64.urlsafe_b64encode(
        hmac.new(JWT_SECRET.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    
    if not hmac.compare_digest(sig, expected):
        raise ValueError("Invalid signature")
    
    # Pad and decode payload
    body += "=" * (-len(body) % 4)
    payload = json.loads(base64.urlsafe_b64decode(body))
    
    if payload.get("exp", 0) < datetime.now(timezone.utc).timestamp():
        raise ValueError("Token expired")
    
    return payload
```

---

## API Endpoints

### `POST /api/auth/login`

**Request**:
```json
{ "username": "admin", "password": "password123" }
```

**Response (200)**:
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer",
  "username": "admin",
  "expires_in": 28800
}
```

**Response (401)**:
```json
{ "detail": "Invalid credentials" }
```

### `GET /api/auth/me`

**Headers**: `Authorization: Bearer <jwt>`

**Response (200)**:
```json
{ "username": "admin", "role": "admin" }
```

---

## FastAPI Auth Middleware

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = verify_token(credentials.credentials)
        return {"username": payload["sub"], "role": payload.get("role", "admin")}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )

# Protected endpoint example:
@app.get("/api/predictions/{coin}")
def get_predictions(coin: str, user = Depends(get_current_user)):
    ...
```

### Protected vs. Public Endpoints

| Endpoint | Auth Required |
|----------|--------------|
| `POST /api/auth/login` | No |
| `GET /api/health` | No |
| `GET /api/stats` | No |
| `GET /api/realtime/{coin}` | Yes |
| `GET /api/historical/{coin}` | Yes |
| `GET /api/predictions/{coin}` | Yes |
| `GET /api/predictions/{coin}/history` | Yes |
| `GET /api/technical/{coin}` | Yes |
| `GET /api/correlation` | Yes |
| `GET /api/inference/status` | Yes |

---

## Frontend Auth Flow

```typescript
// AuthContext.tsx
const AuthContext = createContext<AuthContextValue>(null!);

export function AuthProvider({ children }) {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('crypto_jwt')
  );
  
  const login = async (username: string, password: string) => {
    const res = await api.post('/auth/login', { username, password });
    const { access_token } = res.data;
    localStorage.setItem('crypto_jwt', access_token);
    setToken(access_token);
  };
  
  const logout = () => {
    localStorage.removeItem('crypto_jwt');
    setToken(null);
  };
  
  // Axios interceptor: add Bearer token
  useEffect(() => {
    const id = api.interceptors.request.use(config => {
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return () => api.interceptors.request.eject(id);
  }, [token]);
  
  // Axios interceptor: on 401, logout
  useEffect(() => {
    const id = api.interceptors.response.use(
      r => r,
      err => {
        if (err.response?.status === 401) logout();
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, []);
  
  return (
    <AuthContext.Provider value={{ token, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}
```

---

## Security Notes

1. **Not production-grade**: SHA-256 without salt + no rate limiting = fine for internal tool
2. **Upgrade path**: Replace SHA-256 with bcrypt + add rate limiting for internet-facing deployment
3. **HTTPS required**: JWT in localStorage is vulnerable to XSS; use HTTPS + CSP headers
4. **CORS**: Currently `allow_origins=["*"]` — restrict to known frontend URL in production
