import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { get, send, venus } from "../src/index";
import type { VenusProgress } from "../src/index";

type Behavior = {
  status?: number;
  statusText?: string;
  rawHeaders?: string;
  body?: string;
  delayMs?: number;
  fail?: boolean;
  hang?: boolean;
  binary?: boolean;
};

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  static behavior: Behavior = {};

  static reset() {
    MockXMLHttpRequest.instances = [];
    MockXMLHttpRequest.behavior = {};
  }

  method = "";
  url = "";
  requestHeaders: Record<string, string> = {};
  body: unknown = null;
  responseType = "";
  withCredentials = false;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onprogress: ((event: ProgressEvent) => void) | null = null;

  status = 0;
  statusText = "";
  response: unknown = "";
  responseText = "";

  private aborted = false;
  private rawHeaders = "";

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.requestHeaders[key.toLowerCase()] = value;
  }

  getAllResponseHeaders() {
    return this.rawHeaders;
  }

  send(body: unknown) {
    this.body = body;
    MockXMLHttpRequest.instances.push(this);

    const behavior = MockXMLHttpRequest.behavior;

    if (behavior.hang) {
      return;
    }

    setTimeout(() => {
      if (this.aborted) {
        return;
      }

      if (behavior.fail) {
        this.onerror?.();
        return;
      }

      this.status = behavior.status ?? 200;
      this.statusText = behavior.statusText ?? "OK";
      this.rawHeaders =
        behavior.rawHeaders ?? "content-type: application/json\r\n";

      const text = behavior.body ?? JSON.stringify({ via: "xhr" });

      if (this.responseType === "blob") {
        this.response = new Blob([text], { type: "application/json" });
      } else if (this.responseType === "arraybuffer") {
        this.response = new TextEncoder().encode(text).buffer;
      } else {
        this.responseText = text;
        this.response = text;
      }

      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 100,
        total: 100,
      } as ProgressEvent);

      this.onprogress?.({
        lengthComputable: true,
        loaded: 100,
        total: 100,
      } as ProgressEvent);

      this.onload?.();
    }, behavior.delayMs ?? 5);
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

describe("Venus Hybrid Engine (XHR)", () => {
  beforeEach(() => {
    MockXMLHttpRequest.reset();
    (globalThis as Record<string, unknown>).XMLHttpRequest =
      MockXMLHttpRequest;
    venus.config({ baseURL: "https://api.example.com" });
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).XMLHttpRequest;
    venus.reset();
    vi.restoreAllMocks();
  });

  it("should use fetch by default when no progress callback is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ via: "fetch" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await get<{ via: string }>("/fetch");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.data).toEqual({ via: "fetch" });
    expect(MockXMLHttpRequest.instances).toHaveLength(0);
  });

  it("should switch to XHR transparently when progress is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await get<{ via: string }>("/xhr", {
      progress: () => {},
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ via: "xhr" });
    expect(res.errorCode).toBeNull();

    const xhr = MockXMLHttpRequest.instances[0];
    expect(xhr.method).toBe("GET");
    expect(xhr.url).toBe("https://api.example.com/xhr");
  });

  it("should report upload direction when a body is sent", async () => {
    const events: VenusProgress[] = [];

    const res = await send(
      "/upload",
      { file: "data" },
      { progress: (progress) => events.push(progress) },
    );

    expect(res.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].direction).toBe("upload");
    expect(events[0].loaded).toBe("100B / 100B");
    expect(events[0].percent).toBe(100);
    expect(MockXMLHttpRequest.instances[0].body).toBe(
      JSON.stringify({ file: "data" }),
    );
  });

  it("should report download direction on requests without a body", async () => {
    const events: VenusProgress[] = [];

    const res = await get("/down", {
      progress: (progress) => events.push(progress),
    });

    expect(res.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].direction).toBe("download");
    expect(events[0].percent).toBe(100);
  });

  it("should report HTTP errors through the standard contract", async () => {
    MockXMLHttpRequest.behavior = {
      status: 404,
      statusText: "Not Found",
      body: JSON.stringify({ message: "missing" }),
    };

    const res = await get("/missing", {
      progress: () => {},
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.errorCode).toBe("HTTP_ERROR");
    expect(res.error).toContain("404");
    expect(res.data).toEqual({ message: "missing" });
  });

  it("should map network failures to NETWORK_ERROR", async () => {
    MockXMLHttpRequest.behavior = { fail: true };

    const res = await get("/down", {
      progress: () => {},
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.errorCode).toBe("NETWORK_ERROR");
    expect(res.error).toContain("Network error");
  });

  it("should abort in-flight XHR requests via AbortSignal", async () => {
    MockXMLHttpRequest.behavior = { hang: true };
    const controller = new AbortController();

    const pending = get("/aborted", {
      progress: () => {},
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();

    const res = await pending;

    expect(res.ok).toBe(false);
    expect(res.status).toBe(499);
    expect(res.errorCode).toBe("ABORTED");
    expect(res.error).toContain("aborted");
  });

  it("should enforce the timeout on the XHR engine", async () => {
    MockXMLHttpRequest.behavior = { hang: true };

    const res = await get("/slow", {
      progress: () => {},
      timeout: 20,
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(408);
    expect(res.errorCode).toBe("TIMEOUT");
  });

  it("should parse blob responses through XHR", async () => {
    MockXMLHttpRequest.behavior = {
      body: "binary-content",
      rawHeaders: "content-type: application/octet-stream\r\n",
    };

    const res = await get<Blob>("/blob", {
      progress: () => {},
      responseType: "blob",
    });

    expect(res.ok).toBe(true);
    expect(res.data).toBeInstanceOf(Blob);
    expect(await res.data!.text()).toBe("binary-content");
  });

  it("should parse text responses through XHR", async () => {
    MockXMLHttpRequest.behavior = {
      body: "<xml/>",
      rawHeaders: "content-type: application/xml\r\n",
    };

    const res = await get<string>("/page.html", {
      progress: () => {},
      responseType: "text",
    });

    expect(res.ok).toBe(true);
    expect(res.data).toBe("<xml/>");
  });

  it("should send request headers through XHR", async () => {
    MockXMLHttpRequest.behavior = {};

    const res = await get("/ok", {
      progress: () => {},
      headers: { "X-Engine": "xhr" },
    });

    expect(res.ok).toBe(true);
    expect(MockXMLHttpRequest.instances[0].requestHeaders["x-engine"]).toBe(
      "xhr",
    );
  });
});
