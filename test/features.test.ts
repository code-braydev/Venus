import { describe, it, expect, afterEach, vi } from "vitest";
import { get, send, venus } from "../src/index";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const lastInit = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls[spy.mock.calls.length - 1][1] as RequestInit;

describe("auto content-type", () => {
  afterEach(() => {
    venus.reset();
    vi.restoreAllMocks();
  });

  const cases: Array<[string, unknown, string | null]> = [
    ["object", { a: 1 }, "application/json"],
    ["array", [1, 2], "application/json"],
    ["string", "hello", "text/plain;charset=UTF-8"],
    ["blob with type", new Blob(["x"], { type: "image/png" }), "image/png"],
    ["blob without type", new Blob(["x"]), "application/octet-stream"],
    ["arraybuffer", new Uint8Array([1]).buffer, "application/octet-stream"],
    ["typed array", new Uint8Array([1]), "application/octet-stream"],
    ["formdata", (() => { const f = new FormData(); f.append("a", "1"); return f; })(), null],
    ["urlsearchparams", new URLSearchParams({ a: "1" }), null],
  ];

  for (const [name, body, expected] of cases) {
    it(`sets the right Content-Type for ${name}`, async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({}));
      await send("/x", body);
      const headers = new Headers(lastInit(spy).headers);
      expect(headers.get("content-type")).toBe(expected);
    });
  }

  it("lets an explicit header win", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({}));
    await send("/x", { a: 1 }, { headers: { "Content-Type": "application/vnd.api+json" } });
    expect(new Headers(lastInit(spy).headers).get("content-type")).toBe("application/vnd.api+json");
  });

  it("streams a ReadableStream body with duplex half and no retries", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({}, 503));
    const stream = new ReadableStream({ start: (c) => { c.enqueue(new Uint8Array([1])); c.close(); } });
    await send("/x", stream, { retry: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
    const init = lastInit(spy) as RequestInit & { duplex?: string };
    expect(init.duplex).toBe("half");
    expect(new Headers(init.headers).get("content-type")).toBe("application/octet-stream");
  });

  it("returns INVALID_BODY instead of throwing on unserializable bodies", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const res = await send("/x", circular);
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("INVALID_BODY");
  });
});

describe("responseType stream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the body as a ReadableStream", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("chunk"));
    const res = await get<ReadableStream<Uint8Array>>("/s", { responseType: "stream" });
    expect(res.ok).toBe(true);
    expect(res.data).toBeInstanceOf(ReadableStream);
    const text = await new Response(res.data).text();
    expect(text).toBe("chunk");
  });
});

describe("abort()", () => {
  afterEach(() => {
    venus.reset();
    vi.restoreAllMocks();
  });

  it("cancels every in-flight singleton request as ABORTED", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal;
          const fail = () => reject(new DOMException("Aborted", "AbortError"));
          if (signal?.aborted) {
            fail();
            return;
          }
          signal?.addEventListener("abort", fail);
        }),
    );

    const pending = get("/slow");
    venus.abort();
    const res = await pending;

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("ABORTED");
    expect(res.status).toBe(499);
  });
});

describe("metrics and transport selection", () => {
  afterEach(() => {
    venus.reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  class FakeXHR {
    static sync: boolean[] = [];
    status = 200;
    statusText = "OK";
    responseText = JSON.stringify({ via: "xhr" });
    response: unknown = null;
    responseType = "";
    upload = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onprogress: (() => void) | null = null;
    withCredentials = false;
    open(_m: string, _u: string, async: boolean) { FakeXHR.sync.push(!async); this.async = async; }
    async = true;
    setRequestHeader() {}
    getAllResponseHeaders() { return "content-type: application/json"; }
    abort() {}
    send() { if (this.async) queueMicrotask(() => this.onload?.()); }
  }

  it("stays on fetch and reports metrics: null by default", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ a: 1 }));
    const res = await get("/x");
    expect(res.metrics).toBeNull();
  });

  it("switches to XHR and fills metrics when enabled", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await get<{ via: string }>("/x", { metrics: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.data).toEqual({ via: "xhr" });
    expect(res.metrics).toMatchObject({ engine: "xhr", attempts: 1 });
    expect(res.metrics!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("uses a blocking XHR in hidden legacy sync mode", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    FakeXHR.sync = [];
    venus.config({ legacy: { sync: true } });
    const res = await get<{ via: string }>("/x");
    expect(FakeXHR.sync).toEqual([true]);
    expect(res.data).toEqual({ via: "xhr" });
  });

  it("rejects binary response types in sync mode without throwing", async () => {
    venus.config({ legacy: { sync: true } });
    const res = await get("/x", { responseType: "blob" });
    expect(res.errorCode).toBe("UNSUPPORTED");
  });
});

describe("environments without XMLHttpRequest (Node)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("falls back to fetch for metrics and still reports them", async () => {
    vi.stubGlobal("XMLHttpRequest", undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ a: 1 }));
    const res = await get("/x", { metrics: true });
    expect(res.ok).toBe(true);
    expect(res.metrics).toMatchObject({ engine: "fetch", attempts: 1 });
    vi.unstubAllGlobals();
  });

  it("returns UNSUPPORTED (not NETWORK_ERROR) for progress", async () => {
    vi.stubGlobal("XMLHttpRequest", undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await get("/x", { progress: () => {} });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("UNSUPPORTED");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
