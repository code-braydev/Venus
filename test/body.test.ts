import { describe, it, expect, afterEach, vi } from "vitest";
import { venus } from "../src/index";

const { send, update, get } = venus;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("body handling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends FormData, Blob and URLSearchParams untouched", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ ok: 1 }));
    const form = new FormData();
    form.append("a", "1");
    const blob = new Blob(["x"]);
    const params = new URLSearchParams({ a: "1" });

    for (const body of [form, blob, params]) {
      const res = await send("/up", body);
      expect(res.ok).toBe(true);
    }
    const bodies = spy.mock.calls.map((c) => (c[1] as RequestInit).body);
    expect(bodies[0]).toBe(form);
    expect(bodies[1]).toBe(blob);
    expect(bodies[2]).toBe(params);
  });

  it("sends binary bodies untouched on update", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({}));
    const buf = new Uint8Array([1, 2, 3]);
    await update("/bin", buf);
    expect((spy.mock.calls[0][1] as RequestInit).body).toBe(buf);
  });

  it("still rejects empty objects, arrays and null", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    for (const body of [{}, [], null, undefined, ""]) {
      const res = await send("/x", body);
      expect(res.errorCode).toBe("INVALID_BODY");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not duplicate the Venus prefix on network errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const res = await send("/x", { a: 1 });
    expect(res.error).toBe("Venus: Network error. boom");
    const up = await update("/x", { a: 1 });
    expect(up.error).toBe("Venus: Network error. boom");
  });

  it("uses the server message when present", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ message: "bad name" }, 422));
    expect((await send("/x", { a: 1 })).error).toBe("Venus: bad name");
    expect((await update("/x", { a: 1 })).error).toBe("Venus: Update failed. bad name");
  });

  it("keeps server data on RETRY_EXHAUSTED", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ reason: "down" }, 503));
    const res = await get("/x", { retry: { attempts: 1, backoffMs: 0 } });
    expect(res.errorCode).toBe("RETRY_EXHAUSTED");
    expect(res.data).toEqual({ reason: "down" });
  });

  it("does not report JSON_PARSE_ERROR for non-JSON read failures", async () => {
    const response = new Response("x", { status: 200 });
    vi.spyOn(response, "blob").mockRejectedValue(new Error("read failed"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const res = await get("/x", { responseType: "blob" });
    expect(res.errorCode).toBe("UNKNOWN_ERROR");
  });
});
