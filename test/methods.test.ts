import { describe, it, expect, afterEach, vi } from "vitest";
import { get, send, update, updateOnly, remove } from "../src/index";

describe("Venus Methods (Fully Mocked)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET: should parse JSON response successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 1, name: "Venus" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { ok, data, status, errorCode } = await get<{ id: number; name: string }>("/item/1");
    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data?.name).toBe("Venus");
    expect(errorCode).toBeNull();
  });

  it("GET: should handle 404 HTTP errors with data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const { ok, status, errorCode, error, data } = await get("/missing");
    expect(ok).toBe(false);
    expect(status).toBe(404);
    expect(errorCode).toBe("HTTP_ERROR");
    expect(error).toContain("404");
    expect(data).toEqual({ message: "Not found" });
  });

  it("SEND: should send POST request with body and headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 10, title: "New" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const payload = { title: "New" };
    const { ok, data, status } = await send<any>("/posts", payload);

    expect(ok).toBe(true);
    expect(status).toBe(201);
    expect(data.id).toBe(10);

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it("SEND: should block empty body", async () => {
    const { ok, status, error } = await send("/posts", {});
    expect(ok).toBe(false);
    expect(status).toBe(400);
    expect(error).toContain("empty body");
  });

  it("UPDATE: should perform PUT request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 1, title: "Updated" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const payload = { title: "Updated" };
    const { ok, data } = await update<any>("/posts/1", payload);

    expect(ok).toBe(true);
    expect(data.title).toBe("Updated");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe("PUT");
  });

  it("UPDATEONLY: should perform PATCH request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 1, title: "Patched" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const payload = { title: "Patched" };
    const { ok, data } = await updateOnly<any>("/posts/1", payload);

    expect(ok).toBe(true);
    expect(data.title).toBe("Patched");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
  });

  it("REMOVE: should perform DELETE request and handle 204 No Content", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    const { ok, status, data } = await remove("/posts/1");

    expect(ok).toBe(true);
    expect(status).toBe(204);
    expect(data).toBeNull();
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });
});
