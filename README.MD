# 🪐 Venus

> **EN:** HTTP, without friction. A modern, zero-dependency HTTP client that turns complex fetch patterns into a calm and predictable experience.
>
> **ES:** HTTP, sin fricción. Un cliente HTTP moderno y de cero dependencias que convierte los patrones complejos de fetch en una experiencia tranquila y predecible.

---

### 🚀 New in v3.0.0

- **Declarative Singleton config**: `venus.config({ baseURL, headers, timeout, retry })` in one call.
- **Multi-client mode**: `createClient({ baseURL, headers, timeout, retry })` for independent, self-contained clients.
- **Hybrid engine (`fetch` + `XMLHttpRequest`)**: `fetch` by default; transparent switch to XHR when you enable `metrics` or a `progress` callback.
- **Auto-serialized bodies**: objects/arrays, text, `FormData`, `URLSearchParams`, `File`/`Blob`/`ArrayBuffer` and `ReadableStream` are detected and sent with the right `Content-Type`. No manual headers.
- **`abort()`**: `venus.abort()` / `client.abort()` cancel every in-flight request of that scope.
- **Narrowed responses**: check `ok` and `data` becomes `T`.
- **Scope-wide `hooks` / `onTelemetry`**: interceptors in `venus.config` and `createClient`.
- **Safe retries**: only idempotent methods retry by default.
- **Zero dependencies**: all RSS/Atom support (`getRss`, `fast-xml-parser`) was removed from the core. Venus is a pure HTTP/HTTPS client — no feed code, no parser, nothing extra.

---

### Why Venus?

- **Clean syntax** that stays out of your way
- **Type-safe by default**, from request to response
- **Built-in resilience** (timeouts, retries, predictable errors)
- **Consistent contract**, no matter how a request fails
- **Zero dependencies**, powered by native Web APIs
- **Two configuration modes**: one global singleton or many isolated instances

Venus doesn't try to do everything.
It does one thing **exceptionally well**:
making HTTP requests simple, elegant, and reliable.

---

## 🚀 Quick Start

### 1. Singleton mode (simple, global)

Set your API defaults once at your app's entry point:

```ts
import { venus } from "@braydev/venus";

venus.config({
  baseURL: "https://api.yourdomain.com",
  headers: {
    Authorization: "Bearer my-token",
    "X-App-Version": "3.0.0",
  },
  timeout: 8000,
  retry: { attempts: 2, backoffMs: 200 },
});
```

Only the keys you provide are merged; the rest keep their previous values.
Per-request options always override the global defaults — **except the URL**:
singleton mode is meant for **one API**. Once a `baseURL` is configured the
scope is **closed**: methods only accept relative paths (`venus.get("/users")`) and
absolute URLs return `INVALID_URL`. With **no configuration at all**, absolute
URLs pass straight through (`venus.get("https://api.example.com/users")`). If you
need another API, use `createClient()`.

> **Modes are exclusive.** Choose singleton **or** instances. Once a client is
> created with `createClient()`, the whole `venus` facade (`venus.config()`,
> `venus.get()`, `venus.send()`, ...) is disabled: config calls throw and
> requests return `MODE_CONFLICT`.

```ts
const current = venus.config(); // read back the active configuration
venus.reset();                  // clear everything (e.g. on logout)
```

`venus` is the only configuration surface — there is no legacy config API.

### 2. Multi mode (independent instances)

Create as many isolated clients as you need — perfect for micro-frontends,
multiple APIs or per-service boundaries:

```ts
import { createClient } from "@braydev/venus";

export const api = createClient({
  baseURL: "https://api.example.com",
  headers: { Authorization: "Bearer token" },
  timeout: 8000,
});

export const uploads = createClient({
  baseURL: "https://cdn.example.com",
  timeout: 30_000,
});

api.config(); // { baseURL, headers, timeout, retry } — read-only snapshot
```

> - Instances are **immutable**: configure them once with `createClient()`
>   and read them back with `api.config()` (no setter, no `reset()`).
> - Instances **never** read the global singleton config and never leak their
>   own defaults into it: scope precedence is `per-request > instance > nothing`.
> - Creating an instance locks Venus into **instance mode**: `venus.config()`,
>   `venus.reset()` and `venus.get/send/...` throw or return
>   `MODE_CONFLICT`.

### 3. Make your first request

Venus always returns a predictable response object — no `try/catch` required.

```ts
import { venus } from "@braydev/venus";

const { data, ok, error, errorCode } = await venus.get<User>("/profile", {
  params: { include: ["roles", "permissions"] },
  paramsArrayFormat: "repeat",
});

if (ok) {
  console.log(data.name);
} else {
  console.error(errorCode, error);
}

const result = await venus.send("/users", { name: "Brayan", role: "Developer" });
```

Or through a client (same methods, same contract):

```ts
import { api } from "./client";

const { data } = await api.get<User>("/profile");
```

---

## 📦 API Methods

| Method       | Function                              | Description                                       |
| :----------- | :------------------------------------ | :------------------------------------------------ |
| `get`        | `venus.get<T>(path, options?)`              | Fetch resources with parser/timeout/retry controls. |
| `send`       | `venus.send<T>(path, body, options?)`       | Create resources (POST) with validated body.      |
| `update`     | `venus.update<T>(path, body, options?)`     | Replace resources entirely (PUT).                 |
| `updateOnly` | `venus.updateOnly<T>(path, body, options?)` | Update resources partially (PATCH).               |
| `remove`     | `venus.remove<T>(path, options?)`           | Delete resources with 204 handling.               |
| `abort`      | `venus.abort()` / `client.abort()`    | Cancel every in-flight request of that scope.     |

Every method above has the same signature on a client: `api.get<T>(path, options?)`, `api.send(...)`, and so on. `venus.*` is the singleton; `createClient()` returns an independent one.

### Response Contract

Check `ok` and TypeScript narrows the response for you:

```ts
const res = await venus.get<User>("/me");

if (res.ok) {
  res.data.name; // User — typed, no null check needed
} else {
  res.errorCode; // VenusErrorCode
  res.data;      // unknown: the server's error body, if any
}
```

```ts
type VenusResponse<T> = VenusSuccess<T> | VenusFailure;

type VenusSuccess<T> = {
  ok: true;
  data: T;
  status: number;
  error: null;
  errorCode: null;
  metrics: VenusMetrics | null; // null unless `metrics: true`
};

type VenusFailure = {
  ok: false;
  data: unknown;
  status?: number;
  error: string;
  metrics: VenusMetrics | null;
  errorCode:
    | "HTTP_ERROR"
    | "TIMEOUT"
    | "ABORTED"
    | "NETWORK_ERROR"
    | "JSON_PARSE_ERROR"
    | "INVALID_BODY"
    | "INVALID_URL"
    | "MODE_CONFLICT"
    | "UNSUPPORTED"
    | "RETRY_EXHAUSTED"
    | "UNKNOWN_ERROR";
};
```

A `204 No Content` answer is a success with `data: null`: type it as
`venus.remove<null>("/users/1")`.

```ts
type VenusMetrics = {
  engine: "fetch" | "xhr";
  startedAt: number;   // epoch ms
  durationMs: number;  // total, retries included
  attempts: number;    // 1 = no retries
};
```

This contract is **unchanged** across engines: `fetch` and XHR responses are
normalized into the exact same shape.

---

## ⚙️ Options

With a `baseURL` configured (`venus.config` or `createClient`) paths must be
**relative** (`venus.get("/users")`); absolute paths return `INVALID_URL`. Without
configuration, absolute URLs are allowed.

```ts
{
  headers?: HeadersInit;
  disableHeaders?: string[]; // case-insensitive names removed from the request
  timeout?: number;
  signal?: AbortSignal;
  params?: Record<string, unknown>;
  paramsArrayFormat?: "repeat" | "comma" | "brackets" | "indices";
  body?: unknown; // auto-serialized, see "Request bodies"
  responseType?: "auto" | "json" | "text" | "blob" | "formData" | "arrayBuffer" | "stream";
  metrics?: boolean; // fills `response.metrics` (switches to XHR)
  retry?: boolean | number | {
    attempts?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
    retryOn?: number[];
    shouldRetry?: (ctx) => boolean;
  };
  hooks?: {
    // Returned fields are merged; headers are combined (no mutation needed).
    beforeRequest?: (ctx) => void | RequestInit | Promise<void | RequestInit>;
    afterResponse?: (ctx) => void | Promise<void>;
  };
  onTelemetry?: (event) => void;

  // v3: unified progress callback (switches to XHR automatically)
  progress?: (progress: VenusProgress) => void;
}
```

### Request bodies

Venus detects the payload and sets the `Content-Type` for you. An explicit
`Content-Type` header always wins.

| Body                                  | Sent as                                   |
| :------------------------------------ | :---------------------------------------- |
| object / array                        | JSON, `application/json`                  |
| `string`                              | `text/plain;charset=UTF-8`                |
| `FormData`                            | multipart (runtime sets the boundary)     |
| `URLSearchParams`                     | `application/x-www-form-urlencoded`       |
| `File` / `Blob`                       | its own `type`, else `application/octet-stream` |
| `ArrayBuffer` / typed arrays          | `application/octet-stream`                |
| `ReadableStream`                      | `application/octet-stream` (never retried) |

Empty payloads (`null`, `""`, `{}`, `[]`) return `INVALID_BODY` without
touching the network. `responseType: "stream"` returns `response.body` as a
`ReadableStream` (fetch engine only).

### Aborting

```ts
const controller = new AbortController();
venus.get("/slow", { signal: controller.signal }); // one request
controller.abort();

venus.abort();  // every in-flight singleton request
api.abort();    // every in-flight request of that client
```

Aborted requests resolve as `{ errorCode: "ABORTED", status: 499 }`.

### Dropping an inherited header

```ts
await venus.get("/public", { disableHeaders: ["authorization", "x-app"] });
```

Only that request is affected; the singleton/instance headers stay intact for
the next calls.

---

## 🚚 Hybrid Engine (`fetch` + `XMLHttpRequest`)

Venus is pragmatic about performance: **`fetch` is the default transport**
for its low latency and native streaming. When you pass a `progress` callback,
Venus switches transparently to `XMLHttpRequest` — no flags, no configuration:

```ts
import { venus } from "@braydev/venus";

// Sending a body -> upload progress
await venus.send("/upload", formDataBody, {
  progress: ({ direction, loaded, percent }) => {
    console.log(`${direction}: ${loaded} ${percent}%`);
    // e.g. "upload: 125.0KB / 523.0KB 24%"
  },
});

// Receiving a response -> download progress
await venus.get("/export/large.csv", {
  responseType: "text",
  progress: ({ direction, loaded, percent }) => {
    console.log(`${direction}: ${loaded} ${percent}%`);
    // e.g. "download: 1.5MB / 6.0MB 25%"
  },
});
```

Rules:

- `progress` implies the XHR engine (fetch has no upload progress without
  streams) — the engine selection is always automatic.
- Direction is detected for you: a request that **sends a body** reports
  `direction: "upload"`, everything else reports `direction: "download"`.

Progress payload:

```ts
type VenusProgress = {
  direction: "upload" | "download"; // which transfer is being reported
  loaded: string;                   // human-readable: "125.0KB / 523.0KB"
  percent: number | null;           // 0-100, null when total is unknown
};
```

Timeouts, `AbortSignal`, hooks, telemetry and retries behave identically on
both engines.

> **Node / SSR:** `XMLHttpRequest` does not exist there. `metrics: true` keeps
> working (it falls back to `fetch` and reports `engine: "fetch"`), while
> `progress` resolves as `{ errorCode: "UNSUPPORTED" }` instead of failing
> with a misleading network error.

---

## 🛡️ Resilience

```ts
const res = await venus.get("/flaky", {
  timeout: 5000,
  retry: {
    attempts: 3,
    backoffMs: 200,
    maxBackoffMs: 2000,
    retryOn: [408, 429, 500, 502, 503, 504],
    retryMethods: ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"], // the default
  },
  hooks: {
    beforeRequest: () => ({
      headers: { "X-Trace-Id": crypto.randomUUID() },
    }),
    afterResponse: ({ response, durationMs }) => {
      console.log(response.status, durationMs);
    },
  },
  onTelemetry: (event) => analytics.track("http", event),
});
```

- **Safe retries**: only idempotent methods (GET, HEAD, OPTIONS, PUT, DELETE)
  are retried. `POST` and `PATCH` are **not**, so a retry can never duplicate
  an order or a payment. Opt in with `retryMethods: ["POST"]` or take full
  control with `shouldRetry`.
- **Backoff** is exponential with jitter. A server `Retry-After` header (seconds
  or HTTP date) replaces it, capped at `maxBackoffMs`.
- **Hooks never break the contract**: a throwing `beforeRequest` or
  `afterResponse` resolves as `{ errorCode: "UNKNOWN_ERROR" }`; errors thrown
  by `onTelemetry`, `progress` or `shouldRetry` are ignored.
- **Timeouts** resolve as `{ errorCode: "TIMEOUT", status: 408 }`.
- **Aborted requests** resolve as `{ errorCode: "ABORTED", status: 499 }`.
- **Exhausted retries** resolve as `{ errorCode: "RETRY_EXHAUSTED" }`.
- **Network failures** resolve as `{ errorCode: "NETWORK_ERROR", status: 0 }`.
- **Absolute paths on a configured scope** resolve as `{ errorCode: "INVALID_URL", status: 0 }`.
- **Mixed modes** resolve as `{ errorCode: "MODE_CONFLICT", status: 0 }`.

Requests never throw: the contract always comes back calm and predictable.
Mode misuse on the config surface (`venus.config`, `venus.reset`,
`createClient`) does throw a descriptive `Error`.

---

### Scope-wide interceptors

`hooks` and `onTelemetry` also go in `venus.config` and `createClient`. They
run **before** the per-request ones on every attempt, so the token is read
fresh even on retries:

```ts
const api = createClient({
  baseURL: "https://api.example.com",
  hooks: {
    beforeRequest: () => ({
      headers: { Authorization: `Bearer ${session.token}` },
    }),
  },
  onTelemetry: (event) => analytics.track("http", event),
});
```

---

## 🧭 Query Params

```ts
const { data } = await venus.get("/latest", {
  params: {
    category: "tech",
    limit: 5,
    tags: ["ai", "web"],
    filter: { role: "admin" },
  },
  paramsArrayFormat: "brackets", // repeat | comma | brackets | indices
});
```

Arrays, nested objects, `Date` and `null`/`undefined` handling are built in.

---

## 🔄 Migrating from v2

1. **RSS/Atom support removed**: `getRss` and `fast-xml-parser` are gone.
   Venus v3 is a specialized HTTP/HTTPS client with zero dependencies — no
   feed code and no parsers ship with the package.
2. **`venusConfig` was removed**: replace the granular setters with the
   declarative call (it also covers `timeout` and `retry`):

   | v2 (removed)                       | v3 replacement                    |
   | ---------------------------------- | --------------------------------- |
   | `venusConfig.setBaseURL(url)`      | `venus.config({ baseURL: url })`  |
   | `venusConfig.setGlobalHeaders(h)`  | `venus.config({ headers: h })`    |
   | `venusConfig.getGlobalHeaders()`   | `venus.config().headers`          |
   | `venusConfig.reset()`              | `venus.reset()`                   |

3. **Standalone methods are gone**: `import { get, send, update, updateOnly,
   remove }` became `venus.get(...)`, `venus.send(...)`, etc., symmetric with
   `api.get(...)` on clients. Replace `get("/x")` with `venus.get("/x")`.
4. **New optional `createClient()`**: adopt multi-mode only if you need
   isolated clients; singleton mode behaves like v2 by default. Instances are
   immutable (`config()` is a read-only getter) and modes are **exclusive**:
   creating a client disables the whole `venus` facade.
5. **Closed scopes**: once a `baseURL` is configured, methods only accept
   relative paths (`venus.get("https://…")` returns `INVALID_URL`). Put the API URL
   in `baseURL` and use `venus.get("/users")`. Without configuration, absolute URLs
   still work.
6. **Drop inherited headers per request**: use
   `disableHeaders: ["authorization"]` instead of deleting them manually.
7. **Unified `progress` callback**: `useXHR`, `onUploadProgress` and
   `onDownloadProgress` were replaced by a single `progress` option; the
   engine and the transfer direction are detected automatically.
8. **Hooks merge by return value**: `beforeRequest` should return
   `{ headers: { ... } }`; the result is merged and headers are combined.
   Mutating the received `options` has no effect.

```diff
- import { venusConfig, getRss } from "@braydev/venus";
+ import { venus } from "@braydev/venus";

- venusConfig.setBaseURL("https://api.example.com");
+ venus.config({ baseURL: "https://api.example.com", timeout: 8000 });

- const feed = await getRss("https://example.com/rss.xml");

- onUploadProgress: (p) => {},       // v2
- useXHR: true,                      // v2
+ progress: ({ direction, percent }) => {}, // v3
```

---

## 🧪 Testing

Venus is fully tested with **Vitest**.

```bash
npm test
```

## 📄 License

MIT © [code-braydev](https://github.com/code-braydev)
