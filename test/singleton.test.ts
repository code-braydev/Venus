import { describe, it, expect, afterEach, vi } from "vitest";
import { createClient, get, venus } from "../src/index";

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

  it("should let per-request headers override global defaults", async () => {
    venus.config({
      baseURL: "https://global.example.com",
      headers: { "X-Global": "yes" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await get("/path", { headers: { "X-Global": "no" } });

    const url = String(fetchSpy.mock.calls[0][0]);
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(url).toBe("https://global.example.com/path");
    expect(headers.get("x-global")).toBe("no");
  });

  it("should remove an inherited header with disableHeaders", async () => {
    venus.config({
      baseURL: "https://api.example.com",
      headers: { Authorization: "Bearer token", "X-App": "web" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true }),
    );

    await get("/public", { disableHeaders: ["authorization"] });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-app")).toBe("web");
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

    const res = await get("/slow");

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("TIMEOUT");
    expect(res.status).toBe(408);
  });

  it("should apply the global retry policy until exhausted", async () => {
    venus.config({ retry: 1 });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );

    const res = await get("/flaky");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("RETRY_EXHAUSTED");
    expect(res.status).toBe(503);
  });

  it("should reject absolute URLs once a baseURL is configured", async () => {
    venus.config({ baseURL: "https://api.example.com" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await get("https://other.example.com/plain");

    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.errorCode).toBe("INVALID_URL");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("should let absolute URLs through when nothing is configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ ok: true }));

    const res = await get("https://open.example.com/plain", {
      params: { a: 1 },
    });

    expect(res.ok).toBe(true);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://open.example.com/plain?a=1");
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

  it("should reject createClient after venus.config()", () => {
    venus.config({ baseURL: "https://api.example.com" });

    expect(() =>
      createClient({ baseURL: "https://other.example.com" }),
    ).toThrow(/only one mode/i);
  });
});

describe("scope-wide hooks (singleton)", () => {
  afterEach(() => {
    venus.reset();
    vi.restoreAllMocks();
  });

  it("applies venus.config hooks to standalone requests and clears them on reset", async () => {
    const hook = vi.fn(() => ({ headers: { "X-Scope": "1" } }));
    venus.config({ baseURL: "https://api.example.com", hooks: { beforeRequest: hook } });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({}));

    await get("/x");
    expect(hook).toHaveBeenCalledTimes(1);
    expect(new Headers((fetchSpy.mock.calls[0][1] as RequestInit).headers).get("x-scope")).toBe("1");

    venus.reset();
    venus.config({ baseURL: "https://api.example.com" });
    await get("/x");
    expect(hook).toHaveBeenCalledTimes(1);
  });
});
