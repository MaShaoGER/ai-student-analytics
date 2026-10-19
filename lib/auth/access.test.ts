import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { assertCurrentAccess, withBusinessAccess } from "./access";
import { createUser, initializeAdmin, getUserById, updateUser } from "./service";
import { authorizedDatasets, listManagedDatasets, setDatasetEnabled } from "../datasets/service";
import { profileDatasets } from "../analysis/duckdb";
import { converse } from "../ai/conversation";
import { executeChartTool } from "../ai/chart-tools";
import { converseUnified, unifiedDefaults } from "../ai/unified";

describe("durable dataset and tool access", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "admin-access-"));
    vi.stubEnv("APP_STATE_DIR", directory);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  it("preserves catalog status across reads and separates grants, disabled and missing data", async () => {
    const admin = await initializeAdmin({
      username: "fixture.admin",
      password: "Fixture-Admin-Password!",
    });
    const user = await createUser({
      username: "fixture.user",
      displayName: "测试",
      password: "Fixture-User-Password!",
      role: "user",
      datasetIds: ["demo"],
    });
    expect(authorizedDatasets(user).map((d) => d.id)).toEqual(["demo"]);
    setDatasetEnabled("demo", false, admin.id);
    expect(listManagedDatasets().find((d) => d.id === "demo")?.enabled).toBe(false);
    expect(() => withBusinessAccess(user, "demo", "view", () => null)).toThrow(
      expect.objectContaining({ code: "DATASET_DISABLED" }),
    );
    expect(() => withBusinessAccess(user, "oulad", "view", () => null)).toThrow(
      expect.objectContaining({ code: "DATASET_FORBIDDEN" }),
    );
    setDatasetEnabled("demo", true, admin.id);
    expect(withBusinessAccess(user, "demo", "view", () => "ok")).toBe("ok");
  });
  it("reports unavailable authorized files without turning the error into a grant failure", async () => {
    const user = await createUser({
      username: "fixture.user",
      displayName: "测试",
      password: "Fixture-User-Password!",
      datasetIds: ["demo"],
    });
    vi.stubEnv("DEMO_DATA_DIR", join(directory, "missing-source"));
    expect(authorizedDatasets(user)[0]).toMatchObject({
      id: "demo",
      enabled: true,
      available: false,
    });
    expect(() => withBusinessAccess(user, "demo", "view", () => null)).toThrow(
      expect.objectContaining({ code: "DATA_SOURCE_UNAVAILABLE", status: 503 }),
    );
    const empty = { ...user, datasetIds: [] };
    expect(() => withBusinessAccess(empty, "demo", "view", () => null)).toThrow(
      expect.objectContaining({ code: "DATASET_FORBIDDEN", status: 403 }),
    );
  });
  it("rechecks durable grants after awaits and forbids mixed dataset execution", async () => {
    const user = await createUser({
      username: "fixture.user",
      displayName: "测试",
      password: "Fixture-User-Password!",
      datasetIds: ["demo"],
    });
    await withBusinessAccess(user, "demo", "ai", async () => {
      expect(() => assertCurrentAccess("oulad")).toThrow(
        expect.objectContaining({ code: "DATASET_FORBIDDEN" }),
      );
      updateUser(user.id, { datasetIds: [] });
      await Promise.resolve();
      expect(() => assertCurrentAccess("demo")).toThrow(
        expect.objectContaining({ code: "DATASET_FORBIDDEN" }),
      );
      expect(getUserById(user.id)?.datasetIds).toEqual([]);
    });
    expect(() => withBusinessAccess(getUserById(user.id)!, "demo", "view", () => null)).toThrow();
  });
  it("checks role again inside real AI entry and advanced tools", async () => {
    const user = await createUser({
      username: "fixture.user",
      displayName: "测试",
      password: "Fixture-User-Password!",
      datasetIds: ["demo"],
    });
    await withBusinessAccess(user, "demo", "ai", async () => {
      updateUser(user.id, { role: "readonly" });
      const input = { question: "哪门课程平均成绩最高？", datasetId: "demo", history: [] };
      await expect(converse(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        executeChartTool(
          { kind: "tool", tool: "panorama", view: "chart" } as never,
          input as never,
          {},
          {},
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
  it.each(["grant", "role", "dataset"] as const)(
    "never returns partial artifacts after %s revocation during a model round",
    async (change) => {
      const admin = await initializeAdmin({
        username: "fixture.admin",
        password: "Fixture-Admin-Password!",
      });
      const user = await createUser({
        username: "fixture.user",
        displayName: "测试",
        password: "Fixture-User-Password!",
        datasetIds: ["demo"],
      });
      const generate = vi
        .fn()
        .mockResolvedValueOnce({
          model: "mock",
          message: {
            role: "assistant",
            content: "",
            calls: [
              {
                id: "tool-1",
                name: "aggregate",
                arguments: JSON.stringify({ metric: "score", dimension: "course", filters: [] }),
              },
            ],
          },
        })
        .mockImplementationOnce(async () => {
          if (change === "grant") updateUser(user.id, { datasetIds: [] });
          else if (change === "role") updateUser(user.id, { role: "readonly" });
          else setDatasetEnabled("demo", false, admin.id);
          return { model: "mock", message: { role: "assistant", content: "已完成", calls: [] } };
        });
      const expectedCode =
        change === "grant"
          ? "DATASET_FORBIDDEN"
          : change === "role"
            ? "FORBIDDEN"
            : "DATASET_DISABLED";
      await expect(
        withBusinessAccess(user, "demo", "ai", () =>
          converseUnified(
            { question: "比较各课程平均成绩", datasetId: "demo" },
            {},
            {
              ...unifiedDefaults,
              generate,
              settings: () => ({ enabled: true, maxToolCalls: 6, timeoutSeconds: 60 }),
              capability: () => ({ status: "supported", checkedAt: null }),
            },
          ),
        ),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(generate).toHaveBeenCalledTimes(2);
    },
  );
  it("scopes warm profile caches by authorized sources and bypasses all queries for empty scope", async () => {
    const profiles = await profileDatasets({}, ["demo"]);
    expect(profiles.map((d) => d.id)).toEqual(["demo"]);
    expect(await profileDatasets({}, [])).toEqual([]);
    expect((await profileDatasets({}, ["demo"])).map((d) => d.id)).toEqual(["demo"]);
  });
  it("makes empty-grant accounts stay empty after later reads and updates", async () => {
    const user = await createUser({
      username: "fixture.empty",
      displayName: "空授权",
      password: "Fixture-User-Password!",
    });
    expect(user.datasetIds).toEqual([]);
    updateUser(user.id, { displayName: "仍为空授权" });
    expect(getUserById(user.id)?.datasetIds).toEqual([]);
    expect(authorizedDatasets(getUserById(user.id)!)).toEqual([]);
  });
});
