import { describe, it, expect, afterEach, vi } from "vitest";
import { get, send, updateOnly } from "../src/index";

describe("Venus Resilience & Resilience Strategies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should retry on 503 and recover successfully", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("Service Unavailable", { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const { ok, data, status } = await get("/flaky", {
      retry: {
        attempts: 2,
        backoffMs: 10,
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toEqual({ success: true });
  });

  it("should exhaust retries and return RETRY_EXHAUSTED", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Response("Gateway Timeout", { status: 504 }),
    );

    const { ok, errorCode, status, error } = await get("/down", {
      retry: {
        attempts: 2,
        backoffMs: 5,
      },
    });

    expect(ok).toBe(false);
    expect(errorCode).toBe("RETRY_EXHAUSTED");
    expect(status).toBe(504);
    expect(error).toContain("Retry attempts exhausted");
  });

  it("should respect custom shouldRetry decision", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Response("Bad Request", { status: 400 }),
    );

    const { ok, errorCode, status } = await get("/custom", {
      retry: {
        attempts: 3,
        backoffMs: 5,
        shouldRetry: ({ status }) => status === 400, // Retry on 400 for test purposes
      },
    });

    expect(ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(errorCode).toBe("RETRY_EXHAUSTED");
    expect(status).toBe(400);
  });

  it("should handle network errors (fetch throwing exception)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Failed to fetch"));

    const { ok, errorCode, error, status } = await get("/network-fail");

    expect(ok).toBe(false);
    expect(errorCode).toBe("NETWORK_ERROR");
    expect(status).toBe(0);
    expect(error).toContain("Network error");
  });

  it("should return success when the last retry attempt succeeds", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const { ok, data, errorCode } = await get("/flaky2", {
      retry: { attempts: 2, backoffMs: 5 },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(ok).toBe(true);
    expect(errorCode).toBe(null);
    expect(data).toEqual({ ok: true });
  });

  it("should handle request timeout correctly", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url, init) => {
        const signal = init?.signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
        return new Response("ok", { status: 200 });
      },
    );

    const { ok, errorCode, status } = await get("/slow", {
      timeout: 30,
    });

    expect(ok).toBe(false);
    expect(errorCode).toBe("TIMEOUT");
    expect(status).toBe(408);
  });
});

describe("Safe retry policy", () => {
  const fail503 = (headers: Record<string, string> = {}) =>
    new Response("{}", {
      status: 503,
      headers: { "content-type": "application/json", ...headers },
    });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not retry POST or PATCH by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail503());
    const post = await send("/x", { a: 1 }, { retry: { attempts: 2, backoffMs: 1 } });
    const patch = await updateOnly("/x", { a: 1 }, { retry: { attempts: 2, backoffMs: 1 } });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(post.errorCode).toBe("HTTP_ERROR");
    expect(patch.errorCode).toBe("HTTP_ERROR");
  });

  it("does not retry a POST network error by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const res = await send("/x", { a: 1 }, { retry: { attempts: 2, backoffMs: 1 } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.errorCode).toBe("NETWORK_ERROR");
  });

  it("retries POST when listed in retryMethods", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail503());
    const res = await send("/x", { a: 1 }, {
      retry: { attempts: 2, backoffMs: 1, retryMethods: ["post"] },
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(res.errorCode).toBe("RETRY_EXHAUSTED");
  });

  it("lets a custom shouldRetry override the method policy", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail503());
    await send("/x", { a: 1 }, {
      retry: { attempts: 1, backoffMs: 1, shouldRetry: () => true },
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After (capped by maxBackoffMs)", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => fail503({ "retry-after": "0" }))
      .mockImplementation(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const started = Date.now();
    const res = await get("/x", { retry: { attempts: 1, backoffMs: 500, maxBackoffMs: 500 } });
    expect(res.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);

    const spy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => fail503({ "retry-after": "60" }))
      .mockImplementation(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const t0 = Date.now();
    await get("/x", { retry: { attempts: 1, backoffMs: 1, maxBackoffMs: 50 } });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(spy).toHaveBeenCalled();
  });
});
