import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get, venus } from "../src/index";

describe("Venus Core & Configuration", () => {
  beforeEach(() => {
    venus.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should normalize base URL and set global headers", async () => {
    venus.config({
      baseURL: "https://api.example.com/",
      headers: {
        "X-Custom-Global": "global-val",
        Authorization: "Bearer token-123",
      },
    });

    const current = venus.config();
    expect(current.baseURL).toBe("https://api.example.com");
    expect(current.headers).toEqual({
      "X-Custom-Global": "global-val",
      Authorization: "Bearer token-123",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await get("/test", {
      headers: {
        "X-Custom-Override": "override-val",
        Authorization: "Bearer token-override",
      },
    });

    const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = calledInit.headers as Headers;

    expect(headers.get("x-custom-global")).toBe("global-val");
    expect(headers.get("x-custom-override")).toBe("override-val");
    expect(headers.get("authorization")).toBe("Bearer token-override");
  });

  it("should skip headers when nothing is configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await get("/plain");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toBeUndefined();
  });

  it("should serialize query params correctly with various array formats and nested objects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const date = new Date("2026-04-18T12:00:00.000Z");

    await get("/search", {
      params: {
        query: "venus",
        page: 2,
        active: true,
        date,
        tags: ["ts", "js"],
        filter: { role: "admin", status: "active" },
      },
      paramsArrayFormat: "brackets",
    });

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("query=venus");
    expect(url).toContain("page=2");
    expect(url).toContain("active=true");
    expect(url).toContain("date=2026-04-18T12%3A00%3A00.000Z");
    expect(url).toContain("tags%5B%5D=ts");
    expect(url).toContain("tags%5B%5D=js");
    expect(url).toContain("filter.role=admin");
    expect(url).toContain("filter.status=active");
  });

  it("should support comma array format for query params", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await get("/search", {
      params: { ids: [1, 2, 3] },
      paramsArrayFormat: "comma",
    });

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("ids=1%2C2%2C3");
  });

  it("should handle hooks (beforeRequest and afterResponse) and telemetry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const telemetryEvents: any[] = [];
    let beforeCalled = false;
    let afterCalled = false;

    const result = await get("/hook", {
      hooks: {
        beforeRequest: ({ url, options }) => {
          beforeCalled = true;
          const headers = new Headers(options.headers);
          headers.set("X-Hook-Header", "injected");
          return { ...options, headers };
        },
        afterResponse: ({ response, durationMs }) => {
          afterCalled = true;
          expect(response.status).toBe(200);
          expect(durationMs).toBeGreaterThanOrEqual(0);
        },
      },
      onTelemetry: (event) => {
        telemetryEvents.push(event);
      },
    });

    expect(beforeCalled).toBe(true);
    expect(afterCalled).toBe(true);
    expect(result.ok).toBe(true);
    expect(telemetryEvents.length).toBe(1);
    expect(telemetryEvents[0].ok).toBe(true);
    expect(telemetryEvents[0].status).toBe(200);

    const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = calledInit.headers as Headers;
    expect(headers.get("x-hook-header")).toBe("injected");
  });
});
