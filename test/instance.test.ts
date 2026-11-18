import { describe, it, expect, afterEach, vi } from "vitest";
import { createClient, venus } from "../src/index";

const { get } = venus;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createClient (Multi mode)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use instance baseURL and headers", async () => {
    const api = createClient({
      baseURL: "https://api.a.com/",
      headers: { "X-Api-Key": "a-key" },
      timeout: 3000,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ id: 1 }),
    );

    const res = await api.get<{ id: number }>("/users");

    expect(res.ok).toBe(true);
    expect(String(fetchSpy.mock.calls[0][0])).toBe("https://api.a.com/users");
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("x-api-key")).toBe("a-key");
  });

  it("should let per-request headers override instance defaults", async () => {
    const api = createClient({
      baseURL: "https://instance.example.com",
      headers: { Authorization: "Bearer instance" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await api.get("/secure", {
      headers: { Authorization: "Bearer request" },
    });

    const url = String(fetchSpy.mock.calls[0][0]);
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(url).toBe("https://instance.example.com/secure");
    expect(headers.get("authorization")).toBe("Bearer request");
  });

  it("should remove an inherited header with disableHeaders", async () => {
    const api = createClient({
      baseURL: "https://instance.example.com",
      headers: { Authorization: "Bearer instance", "X-App": "web" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await api.get("/public", { disableHeaders: ["authorization"] });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-app")).toBe("web");
  });

  it("should expose the immutable defaults via config()", () => {
    const api = createClient({
      baseURL: "https://a.example.com/",
      headers: { "X-A": "1" },
      timeout: 1000,
      retry: 2,
    });

    const snapshot = api.config();
    expect(snapshot.baseURL).toBe("https://a.example.com");
    expect(snapshot.headers).toEqual({ "X-A": "1" });
    expect(snapshot.timeout).toBe(1000);
    expect(snapshot.retry).toBe(2);

    snapshot.headers!["X-A"] = "mutated";
    expect(api.config().headers).toEqual({ "X-A": "1" });
  });

  it("should reject absolute URLs in instance methods", async () => {
    const api = createClient({ baseURL: "https://api.example.com" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await api.get("https://other.example.com/path");

    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.errorCode).toBe("INVALID_URL");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("should block standalone requests in instance mode", async () => {
    createClient({ baseURL: "https://api.example.com" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await get("/standalone");

    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.errorCode).toBe("MODE_CONFLICT");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("should block the singleton facade in instance mode", () => {
    createClient({ baseURL: "https://api.example.com" });

    expect(() => venus.config({ baseURL: "https://other.example.com" })).toThrow(
      /singleton API is disabled/i,
    );
    expect(() => venus.reset()).toThrow(/singleton API is disabled/i);
  });

  it("should merge a partial beforeRequest result", async () => {
    const api = createClient({
      baseURL: "https://api.example.com",
      headers: { "X-Instance": "1" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }, 201),
    );

    const res = await api.send(
      "/items",
      { name: "x" },
      {
        hooks: {
          beforeRequest: () => ({ headers: { "X-Partial": "yes" } }),
        },
      },
    );

    expect(res.ok).toBe(true);

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "x" }));
    const headers = init.headers as Headers;
    expect(headers.get("x-partial")).toBe("yes");
    expect(headers.get("x-instance")).toBe("1");
  });

  it("should ignore mutations to the hook options copy", async () => {
    const api = createClient({
      baseURL: "https://api.example.com",
      headers: { "X-Instance": "1" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await api.get("/safe", {
      hooks: {
        beforeRequest: ({ options }) => {
          (options.headers as Headers).set("X-Hacked", "1");
        },
      },
    });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("x-hacked")).toBeNull();
    expect(headers.get("x-instance")).toBe("1");
  });

  it("should expose every HTTP method with the shared response contract", async () => {
    const api = createClient({ baseURL: "https://api.example.com" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url, init) => jsonResponse({ method: init?.method }, 201),
    );

    const getRes = await api.get("/item");
    const postRes = await api.send("/item", { name: "x" });
    const putRes = await api.update("/item", { name: "y" });
    const patchRes = await api.updateOnly("/item", { name: "z" });
    const delRes = await api.remove("/item");

    for (const res of [getRes, postRes, putRes, patchRes, delRes]) {
      expect(res).toHaveProperty("ok");
      expect(res).toHaveProperty("status");
      expect(res).toHaveProperty("error");
      expect(res).toHaveProperty("errorCode");
      expect(res).toHaveProperty("data");
    }

    const methods = fetchSpy.mock.calls.map(
      (call) => (call[1] as RequestInit).method,
    );
    expect(methods).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    expect(getRes.data).toEqual({ method: "GET" });
    expect(postRes.status).toBe(201);
  });

  it("should still block empty bodies in send()", async () => {
    const api = createClient({ baseURL: "https://api.example.com" });
    vi.spyOn(globalThis, "fetch");

    const res = await api.send("/item", {});

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.errorCode).toBe("INVALID_BODY");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("should apply the instance timeout", async () => {
    const api = createClient({ baseURL: "https://api.example.com", timeout: 15 });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const res = await api.get("/slow");

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("TIMEOUT");
    expect(res.status).toBe(408);
  });
});

describe("scope-wide hooks and telemetry (client)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs client hooks before request hooks on every attempt and merges headers", async () => {
    const calls: string[] = [];
    const api = createClient({
      baseURL: "https://api.example.com",
      hooks: {
        beforeRequest: ({ attempt }) => {
          calls.push(`scope:${attempt}`);
          return { headers: { Authorization: `Bearer t${attempt}` } };
        },
      },
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => jsonResponse({}, 503))
      .mockImplementation(async () => jsonResponse({ ok: true }));

    const res = await api.get("/x", {
      retry: { attempts: 1, backoffMs: 1 },
      hooks: {
        beforeRequest: ({ attempt }) => {
          calls.push(`request:${attempt}`);
          return { headers: { "X-Req": "1" } };
        },
      },
    });

    expect(res.ok).toBe(true);
    expect(calls).toEqual(["scope:0", "request:0", "scope:1", "request:1"]);
    const headers = new Headers((fetchSpy.mock.calls[1][1] as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer t1");
    expect(headers.get("x-req")).toBe("1");
  });

  it("calls client and request telemetry listeners and exposes them in config()", async () => {
    const seen: string[] = [];
    const api = createClient({
      baseURL: "https://api.example.com",
      onTelemetry: () => seen.push("scope"),
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}));

    await api.get("/x", { onTelemetry: () => seen.push("request") });

    expect(seen).toEqual(["scope", "request"]);
    expect(typeof api.config().onTelemetry).toBe("function");
  });
});
