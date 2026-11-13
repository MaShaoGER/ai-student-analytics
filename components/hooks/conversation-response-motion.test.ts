import { describe, expect, it } from "vitest";
import { responseIdToAnimate } from "./conversation-response-motion";

const reply = (id: string, restored = false) => ({
  id, role: "assistant", response: {}, restored,
});

describe("responseIdToAnimate", () => {
  it("does not replay an older reply when a failed request leaves messages unchanged", () => {
    expect(responseIdToAnimate([reply("first"), reply("second")], "second")).toBeNull();
  });
  it("does not replay an older reply when the newest assistant turn is a cancellation", () => {
    expect(responseIdToAnimate([reply("first"), { id: "cancelled", role: "assistant" }], "first")).toBeNull();
  });
  it("animates the newly completed reply", () => {
    expect(responseIdToAnimate([reply("first"), reply("second")], "first")).toBe("second");
  });
  it("does not animate restored history", () => {
    expect(responseIdToAnimate([reply("first"), reply("restored", true)], "first")).toBeNull();
  });
  it("handles the first response and an empty conversation", () => {
    expect(responseIdToAnimate([], null)).toBeNull();
    expect(responseIdToAnimate([reply("first")], null)).toBe("first");
  });
});
