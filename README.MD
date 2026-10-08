# 🪐 Venus

> **EN:** HTTP, without friction. A modern, zero-dependency HTTP client that turns complex fetch patterns into a calm and predictable experience.
>
> **ES:** HTTP, sin fricción. Un cliente HTTP moderno y de cero dependencias que convierte los patrones complejos de fetch en una experiencia tranquila y predecible.

---

### 🚀 New in v3.0.0

- **Declarative Singleton config**: `venus.config({ baseURL, headers, timeout, retry })` in one call.
- **Multi-instance mode**: `createInstance({ baseURL, headers, timeout, retry })` for independent, self-contained clients.
- **Hybrid engine (`fetch` + `XMLHttpRequest`)**: `fetch` by default; transparent switch to XHR when you need detailed metrics and upload/download progress.
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
Per-request options always override the global defaults.

```ts
const current = venus.config(); // read back the active configuration
venus.reset();                  // clear everything (e.g. on logout)
```

`venus` is the only configuration surface — there is no legacy config API.

### 2. Multi mode (independent instances)

Create as many isolated clients as you need — perfect for micro-frontends,
multiple APIs or per-service boundaries:

```ts
import { createInstance } from "@braydev/venus";

export const api = createInstance({
  baseURL: "https://api.example.com",
  headers: { Authorization: "Bearer token" },
  timeout: 8000,
});

export const uploads = createInstance({
  baseURL: "https://cdn.example.com",
  timeout: 30_000,
});
```

> Instances **never** read the global singleton config and never leak their
> own defaults into it: scope precedence is `per-request > instance > nothing`.

### 3. Make your first request

Venus always returns a predictable response object — no `try/catch` required.

```ts
import { get, send } from "@braydev/venus";

const { data, ok, error, errorCode } = await get<User>("/profile", {
  params: { include: ["roles", "permissions"] },
  paramsArrayFormat: "repeat",
});

if (ok) {
  console.log(data.name);
} else {
  console.error(errorCode, error);
}

const result = await send("/users", { name: "Brayan", role: "Developer" });
```

Or through an instance:

```ts
import { api } from "./client";

const { data } = await api.get<User>("/profile");
```

---

## 📦 API Methods

| Method       | Function                              | Description                                       |
| :----------- | :------------------------------------ | :------------------------------------------------ |
| `get`        | `get<T>(path, options?)`              | Fetch resources with parser/timeout/retry controls. |
| `send`       | `send<T>(path, body, options?)`       | Create resources (POST) with validated body.      |
| `update`     | `update<T>(path, body, options?)`     | Replace resources entirely (PUT).                 |
| `updateOnly` | `updateOnly<T>(path, body, options?)` | Update resources partially (PATCH).               |
| `remove`     | `remove<T>(path, options?)`           | Delete resources with 204 handling.               |

Every method is also available on instances created with `createInstance()`.

### Response Contract

```ts
type VenusResponse<T> = {
  data: T | null;
  ok: boolean;
  error: string | null;
  status?: number;
  errorCode:
    | "HTTP_ERROR"
    | "TIMEOUT"
    | "ABORTED"
    | "NETWORK_ERROR"
    | "JSON_PARSE_ERROR"
    | "INVALID_BODY"
    | "RETRY_EXHAUSTED"
    | "UNKNOWN_ERROR"
    | null;
};
```

This contract is **unchanged** across engines: `fetch` and XHR responses are
normalized into the exact same shape.

---

## ⚙️ Options

```ts
{
  headers?: HeadersInit;
  baseUrl?: string;
  timeout?: number;
  signal?: AbortSignal;
  params?: Record<string, unknown>;
  paramsArrayFormat?: "repeat" | "comma" | "brackets" | "indices";
  responseType?: "auto" | "json" | "text" | "blob" | "formData" | "arrayBuffer";
  retry?: boolean | number | {
    attempts?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
    retryOn?: number[];
    shouldRetry?: (ctx) => boolean;
  };
  hooks?: {
    beforeRequest?: (ctx) => void | RequestInit | Promise<void | RequestInit>;
    afterResponse?: (ctx) => void | Promise<void>;
  };
  onTelemetry?: (event) => void;

  // v3: unified progress callback (switches to XHR automatically)
  progress?: (progress: VenusProgress) => void;
}
```

---

## 🚚 Hybrid Engine (`fetch` + `XMLHttpRequest`)

Venus is pragmatic about performance: **`fetch` is the default transport**
for its low latency and native streaming. When you pass a `progress` callback,
Venus switches transparently to `XMLHttpRequest` — no flags, no configuration:

```ts
import { send, get } from "@braydev/venus";

// Sending a body -> upload progress
await send("/upload", formDataBody, {
  progress: ({ direction, loaded, percent }) => {
    console.log(`${direction}: ${loaded} ${percent}%`);
    // e.g. "upload: 125.0KB / 523.0KB 24%"
  },
});

// Receiving a response -> download progress
await get("/export/large.csv", {
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

---

## 🛡️ Resilience

```ts
const res = await get("/flaky", {
  timeout: 5000,
  retry: {
    attempts: 3,
    backoffMs: 200,
    maxBackoffMs: 2000,
    retryOn: [408, 429, 500, 502, 503, 504],
  },
  hooks: {
    beforeRequest: ({ options }) => {
      const headers = new Headers(options.headers);
      headers.set("X-Trace-Id", crypto.randomUUID());
      return { ...options, headers };
    },
    afterResponse: ({ response, durationMs }) => {
      console.log(response.status, durationMs);
    },
  },
  onTelemetry: (event) => analytics.track("http", event),
});
```

- **Timeouts** resolve as `{ errorCode: "TIMEOUT", status: 408 }`.
- **Aborted requests** resolve as `{ errorCode: "ABORTED", status: 499 }`.
- **Exhausted retries** resolve as `{ errorCode: "RETRY_EXHAUSTED" }`.
- **Network failures** resolve as `{ errorCode: "NETWORK_ERROR", status: 0 }`.

Nothing throws: the contract always comes back calm and predictable.

---

## 🧭 Query Params

```ts
const { data } = await get("/latest", {
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

3. **New optional `createInstance()`**: adopt multi-mode only if you need
   isolated clients; singleton mode behaves like v2 by default.
4. **Unified `progress` callback**: `useXHR`, `onUploadProgress` and
   `onDownloadProgress` were replaced by a single `progress` option; the
   engine and the transfer direction are detected automatically.

```diff
- import { venusConfig, getRss } from "@braydev/venus";
+ import { venus, get } from "@braydev/venus";

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
