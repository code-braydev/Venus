import { describe, it, expectTypeOf } from "vitest";
import { venus, createClient } from "../src/index";
import type { VenusErrorCode } from "../src/index";

type User = { name: string };
const { get, remove } = venus;

describe("VenusResponse narrowing", () => {
  it("narrows data to T when ok is true", async () => {
    const res = await get<User>("/me");
    if (res.ok) {
      expectTypeOf(res.data).toEqualTypeOf<User>();
      expectTypeOf(res.error).toEqualTypeOf<null>();
      expectTypeOf(res.errorCode).toEqualTypeOf<null>();
    } else {
      expectTypeOf(res.data).toEqualTypeOf<unknown>();
      expectTypeOf(res.error).toEqualTypeOf<string>();
      expectTypeOf(res.errorCode).toEqualTypeOf<VenusErrorCode>();
    }
  });

  it("narrows through destructuring", async () => {
    const { data, ok } = await get<User>("/me");
    if (ok) {
      expectTypeOf(data).toEqualTypeOf<User>();
    }
  });

  it("works the same on clients and remove<null>", async () => {
    const api = createClient({ baseURL: "https://api.example.com" });
    const res = await api.get<User>("/me");
    if (res.ok) {
      expectTypeOf(res.data.name).toEqualTypeOf<string>();
    }
    const del = await remove<null>("/x");
    if (del.ok) {
      expectTypeOf(del.data).toEqualTypeOf<null>();
    }
  });
});
