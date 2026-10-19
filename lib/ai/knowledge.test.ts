import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  knowledgeDocuments,
  searchKnowledge,
  rebuildKnowledgeIndex,
  getKnowledgeIndex,
} from "./knowledge";
import { METRICS } from "../analysis/metrics";

afterEach(() => vi.unstubAllEnvs());
describe("versioned teaching retrieval", () => {
  it("generates metric facts from the owning code", () => {
    for (const [id, metric] of Object.entries(METRICS))
      expect(knowledgeDocuments().find((doc) => doc.id === `metric-${id}`)?.excerpt).toContain(
        metric.formula,
      );
  });
  it("filters by source and keeps absence separate from activity", () => {
    const result = searchKnowledge("OULAD缺勤出勤率", "oulad", knowledgeDocuments());
    expect(result.citations.some((citation) => citation.id === "attendance-demo")).toBe(false);
    expect(result.citations.find((citation) => citation.id === "oulad-limits")?.excerpt).toContain(
      "没有校园出勤",
    );
  });
  it("does not invent evidence and withholds conflicting versions", () => {
    expect(searchKnowledge("完全未知政策", "demo", knowledgeDocuments()).status).toBe("not_found");
    const doc = knowledgeDocuments()[0];
    const found = searchKnowledge("平均成绩", "demo", [
      doc,
      { ...doc, version: "old", excerpt: "contradicting text" },
    ]);
    expect(found).toEqual({ status: "conflict", citations: [] });
  });
  it("rebuilds a real local snapshot with bounded sources", () => {
    const directory = mkdtempSync(join(tmpdir(), "knowledge-index-"));
    vi.stubEnv("APP_STATE_DIR", directory);
    try {
      const status = rebuildKnowledgeIndex();
      expect(status.builtAt).not.toBeNull();
      expect(status.count).toBe(8);
      expect(getKnowledgeIndex().documents).toEqual(knowledgeDocuments());
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
