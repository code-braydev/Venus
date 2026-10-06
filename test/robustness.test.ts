import { describe, it, expect, afterEach, vi } from "vitest";
import { get, send, update, updateOnly, remove, getRss, venusConfig } from "../src/index";

describe("Venus Ultimate Robustness & Edge Case Test Suite", () => {
  afterEach(() => {
    venusConfig.setBaseURL("");
    venusConfig.setGlobalHeaders({});
    vi.restoreAllMocks();
  });

  describe("1. Advanced Query Parameter Serialization", () => {
    it("should serialize query params with 'repeat' array format (default)", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      await get("https://api.example.com/endpoint", {
        params: {
          categories: ["news", "tech"],
          nullVal: null,
          undefVal: undefined,
        },
        paramsArrayFormat: "repeat",
      });

      const url = String(fetchSpy.mock.calls[0][0]);
      expect(url).toContain("categories=news");
      expect(url).toContain("categories=tech");
      expect(url).not.toContain("nullVal");
      expect(url).not.toContain("undefVal");
    });

    it("should serialize query params with 'indices' array format", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      await get("https://api.example.com/endpoint", {
        params: {
          items: ["a", "b"],
        },
        paramsArrayFormat: "indices",
      });

      const url = String(fetchSpy.mock.calls[0][0]);
      expect(url).toContain("items%5B0%5D=a");
      expect(url).toContain("items%5B1%5D=b");
    });

    it("should handle existing query params in base URL or path correctly", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      await get("https://api.example.com/path?existing=1", {
        params: { added: 2 },
      });

      const url = String(fetchSpy.mock.calls[0][0]);
      expect(url).toBe("https://api.example.com/path?existing=1&added=2");
    });
  });

  describe("2. Response Types & Parsing Edge Cases", () => {
    it("should parse blob response type successfully", async () => {
      const blobContent = new Blob(["binary data"], { type: "text/plain" });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(blobContent, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );

      const res = await get<Blob>("https://api.example.com/blob", { responseType: "blob" });
      expect(res.ok).toBe(true);
      expect(res.data).toBeInstanceOf(Blob);
      const text = await res.data!.text();
      expect(text).toBe("binary data");
    });

    it("should parse arrayBuffer response type successfully", async () => {
      const buffer = new Uint8Array([1, 2, 3]).buffer;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(buffer, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      );

      const res = await get<ArrayBuffer>("https://api.example.com/buffer", { responseType: "arrayBuffer" });
      expect(res.ok).toBe(true);
      expect(res.data).toBeInstanceOf(ArrayBuffer);
      expect(res.data?.byteLength).toBe(3);
    });

    it("should parse formData response type successfully", async () => {
      const formData = new FormData();
      formData.append("key", "value");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(formData, {
          status: 200,
        }),
      );

      const res = await get<FormData>("https://api.example.com/form", { responseType: "formData" });
      expect(res.ok).toBe(true);
      expect(res.data).toBeInstanceOf(FormData);
      expect(res.data?.get("key")).toBe("value");
    });

    it("should return PARSING_ERROR when JSON response is malformed", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{ invalid json }", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const res = await get("https://api.example.com/malformed", { responseType: "json" });
      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe("PARSING_ERROR");
      expect(res.error).toContain("Response parsing failed");
    });

    it("should handle 205 Reset Content properly", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, {
          status: 205,
        }),
      );

      const res = await get("https://api.example.com/reset");
      expect(res.ok).toBe(true);
      expect(res.status).toBe(205);
      expect(res.data).toBeNull();
    });
  });

  describe("3. Advanced Resilience & Abort Signals", () => {
    it("should respect external AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();

      vi.spyOn(globalThis, "fetch").mockImplementation(async (_, init) => {
        if ((init as RequestInit)?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return new Response("ok", { status: 200 });
      });

      const res = await get("https://api.example.com/aborted", {
        signal: controller.signal,
      });

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe("ABORTED");
      expect(res.status).toBe(499);
      expect(res.error).toContain("Request was aborted");
    });

    it("should handle backoff exponential calculation and retry exhaustion with custom retryOn", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Too Many Requests", { status: 429 }),
      );

      const res = await get("https://api.example.com/rate-limited", {
        retry: {
          attempts: 2,
          backoffMs: 2,
          maxBackoffMs: 10,
          retryOn: [429],
        },
      });

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe("RETRY_EXHAUSTED");
      expect(res.status).toBe(429);
    });
  });

  describe("4. Advanced Hooks & Telemetry", () => {
    it("should support async beforeRequest hook modifying request init", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const res = await get("https://api.example.com/hook-async", {
        hooks: {
          beforeRequest: async ({ options }) => {
            await new Promise((r) => setTimeout(r, 5));
            const headers = new Headers(options.headers);
            headers.set("X-Async-Auth", "token-xyz");
            return { ...options, headers };
          },
        },
      });

      expect(res.ok).toBe(true);
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      expect((init.headers as Headers).get("x-async-auth")).toBe("token-xyz");
    });

    it("should capture telemetry across all retry attempts", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Error", { status: 500 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );

      const events: any[] = [];
      await get("https://api.example.com/telemetry-retry", {
        retry: { attempts: 1, backoffMs: 2 },
        onTelemetry: (ev) => events.push(ev),
      });

      expect(events.length).toBe(2);
      expect(events[0].attempt).toBe(0);
      expect(events[0].ok).toBe(false);
      expect(events[0].status).toBe(500);
      expect(events[1].attempt).toBe(1);
      expect(events[1].ok).toBe(true);
      expect(events[1].status).toBe(200);
    });
  });

  describe("5. Additional HTTP Methods Validation", () => {
    it("should send PUT update with correct method and body", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ updated: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const res = await update("https://api.example.com/resource/1", { name: "Venus v2" });
      expect(res.ok).toBe(true);
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe("PUT");
      expect(init.body).toBe(JSON.stringify({ name: "Venus v2" }));
    });

    it("should send PATCH updateOnly with correct method and body", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ patched: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const res = await updateOnly("https://api.example.com/resource/1", { name: "Patch" });
      expect(res.ok).toBe(true);
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe("PATCH");
    });
  });

  describe("6. RSS Robustness & Error Handling", () => {
    it("should handle network errors gracefully in getRss", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("DNS lookup failed"));

      const res = await getRss("https://api.example.com/rss-fail");
      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe("NETWORK_ERROR");
      expect(res.error).toContain("DNS lookup failed");
    });

    it("should return PARSING_ERROR for non-XML text response in getRss", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Just plain text, not xml", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );

      const res = await getRss("https://api.example.com/plain");
      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe("PARSING_ERROR");
    });
  });
});
