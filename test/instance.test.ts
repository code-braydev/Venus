import { describe, it, expect, afterEach, vi } from "vitest";
import { createInstance, venus, get, send } from "../src/index";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("venus.config (Singleton mode)", () => {
  afterEach(() => {
    venus.reset();
    vi.restoreAllMocks();
  });

  it("should apply baseURL, headers, timeout and retry declaratively", async () => {
    venus.config({
      baseURL: "https://api.example.com/",
      headers: { Authorization: "Bearer global-token" },
      timeout: 5000,
      retry: 2,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await get("/users");

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "https://api.example.com/users",
    );
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer global-token");
    expect(venus.config().timeout).toBe(5000);
    expect(venus.config().retry).toBe(2);
  });

  it("should let per-request options override global defaults", async () => {
    venus.config({
      baseURL: "https://global.example.com",
      headers: { "X-Global": "yes" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await get("/path", {
      baseUrl: "https://override.example.com",
      headers: { "X-Global": "no" },
    });

    const url = String(fetchSpy.mock.calls[0][0]);
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(url.startsWith("https://override.example.com/path")).toBe(true);
    expect(headers.get("x-global")).toBe("no");
  });

  it("should apply the global timeout to requests", async () => {
    venus.config({ timeout: 15 });

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

    const res = await get("https://api.example.com/slow");

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("TIMEOUT");
    expect(res.status).toBe(408);
  });

  it("should apply the global retry policy until exhausted", async () => {
    venus.config({ retry: 1 });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );

    const res = await get("https://api.example.com/flaky");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("RETRY_EXHAUSTED");
    expect(res.status).toBe(503);
  });

  it("should clear everything with venus.reset()", () => {
    venus.config({
      baseURL: "https://api.example.com",
      headers: { Authorization: "x" },
      timeout: 1000,
      retry: true,
    });

    venus.reset();

    const current = venus.config();
    expect(current.baseURL).toBe("");
    expect(current.headers).toEqual({});
    expect(current.timeout).toBeUndefined();
    expect(current.retry).toBeUndefined();
  });
});

describe("createInstance (Multi mode)", () => {
  afterEach(() => {
    venus.reset();
    vi.restoreAllMocks();
  });

  it("should use instance baseURL and headers", async () => {
    const api = createInstance({
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

  it("should stay isolated from the global singleton config", async () => {
    venus.config({
      baseURL: "https://global.example.com",
      headers: { "X-Global": "global-token" },
    });

    const api = createInstance({
      baseURL: "https://instance.example.com",
      headers: { "X-Instance": "instance-token" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await api.get("/profile");

    const url = String(fetchSpy.mock.calls[0][0]);
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;

    expect(url.startsWith("https://instance.example.com/profile")).toBe(true);
    expect(headers.get("x-instance")).toBe("instance-token");
    expect(headers.get("x-global")).toBeNull();
  });

  it("should let per-request options override instance defaults", async () => {
    const api = createInstance({
      baseURL: "https://instance.example.com",
      headers: { Authorization: "Bearer instance" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await api.get("/secure", {
      headers: { Authorization: "Bearer request" },
      baseUrl: "https://request.example.com",
    });

    const url = String(fetchSpy.mock.calls[0][0]);
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(url.startsWith("https://request.example.com/secure")).toBe(true);
    expect(headers.get("authorization")).toBe("Bearer request");
  });

  it("should merge new defaults via instance.config()", async () => {
    const api = createInstance({ baseURL: "https://a.example.com" });
    api.config({ baseURL: "https://b.example.com", headers: { "X-Layer": "2" } });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await api.get("/ping");

    const url = String(fetchSpy.mock.calls[0][0]);
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(url.startsWith("https://b.example.com/ping")).toBe(true);
    expect(headers.get("x-layer")).toBe("2");
  });

  it("should expose every HTTP method with the shared response contract", async () => {
    const api = createInstance({ baseURL: "https://api.example.com" });
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
    const api = createInstance({ baseURL: "https://api.example.com" });
    vi.spyOn(globalThis, "fetch");

    const res = await api.send("/item", {});

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.errorCode).toBe("INVALID_BODY");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("should apply the instance timeout", async () => {
    const api = createInstance({ baseURL: "https://api.example.com", timeout: 15 });

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

  it("should not leak instance config into standalone singleton requests", async () => {
    const api = createInstance({ baseURL: "https://instance.example.com" });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await api.get("/a");
    await get("/b");

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "https://instance.example.com/a",
    );
    expect(String(fetchSpy.mock.calls[1][0])).toBe("/b");
  });

  it("should keep standalone send working with global config", async () => {
    venus.config({ baseURL: "https://global.example.com" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ created: true }, 201),
    );

    const res = await send("/items", { name: "venus" });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(201);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "https://global.example.com/items",
    );
  });
});
