import { describe, it, expect } from "vitest";
import * as lib from "../src/index";
import { venus, createClient } from "../src/index";

describe("public surface", () => {
  it("exposes only venus and createClient (no standalone methods)", () => {
    expect(Object.keys(lib).sort()).toEqual(["createClient", "venus"]);
    expect((lib as Record<string, unknown>).get).toBeUndefined();
    expect((lib as Record<string, unknown>).send).toBeUndefined();
  });

  it("venus carries config, reset, abort and the five request methods", () => {
    for (const key of ["config", "reset", "abort", "get", "send", "update", "updateOnly", "remove"] as const) {
      expect(typeof venus[key]).toBe("function");
    }
  });

  it("venus methods are closed once a client claims the process", async () => {
    createClient({ baseURL: "https://api.example.com" });
    const res = await venus.get("/x");
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("MODE_CONFLICT");
  });
});
