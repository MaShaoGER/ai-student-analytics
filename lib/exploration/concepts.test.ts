import { describe, expect, it } from "vitest";
import type { ConceptExplorerData } from "../analysis/concept-explorer";
import { conceptHref, conceptTopicKey, metricLocation, ownsBrowseLocation, parseConceptLocation, type ConceptLocation } from "./concepts";

const grades: ConceptExplorerData = {
  datasetId: "demo", datasetName: "字段有限的数据", synthetic: false, term: "2025J", terms: ["2025J"],
  courses: [], totalCourses: 0, courseLimit: 100, detail: null,
  capabilities: { attendance: false, homework: false, completion: false },
};

describe("concept exploration boundaries", () => {
  it("preserves the course, term and relationship when a shared URL is reopened", () => {
    const location: ConceptLocation = { scene: "metric", course: "数据结构 & 算法", term: "2025J", metric: "attendance", relation: "band-pass", drawing: "dots" };
    expect(parseConceptLocation(conceptHref(location, "demo"))).toEqual({ status: "valid", datasetId: "demo", location });
  });

  it("rejects explicit empty or ambiguous addresses instead of silently opening a different topic", () => {
    for (const url of ["/?browse=", "/?browse=home&dataset=", "/?browse=home&term=", "/?browse=course&course=", "/?browse=home&dataset=demo&dataset=oulad", "/?browse=home&course=数据结构", "/?browse=metric&course=数据结构&indicator=attendance&relation=dist", "/?browse=metric&course=数据结构&indicator=constructor&relation=subject"]) {
      expect(parseConceptLocation(url).status, url).toBe("invalid");
    }
  });

  it("does not accept a drawing which would change the selected relationship", () => {
    expect(parseConceptLocation("/?browse=metric&course=数据结构&indicator=attendance&relation=band-score&drawing=radar").status).toBe("invalid");
    expect(parseConceptLocation("/?browse=metric&course=数据结构&indicator=attendance&relation=band-score&drawing=bars").status).toBe("valid");
  });

  it("never invents attendance or homework for a source without those fields", () => {
    expect(metricLocation("数据结构", "attendance", "2025J", grades)).toBeNull();
    expect(metricLocation("数据结构", "homework", "2025J", grades)).toBeNull();
    expect(metricLocation("数据结构", "completion", "2025J", grades)).toBeNull();
    expect(metricLocation("数据结构", "score", "2025J", grades)).toMatchObject({ scene: "metric", metric: "score", relation: "dist", course: "数据结构" });
  });

  it("normalises padded course and term values so the address it writes back is canonical", () => {
    const padded = parseConceptLocation("/?browse=course&course=%20%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84%20&term=%202025J%20");
    expect(padded).toMatchObject({ status: "valid", location: { scene: "course", course: "数据结构", term: "2025J" } });
    if (padded.status !== "valid") return;
    expect(parseConceptLocation(conceptHref(padded.location, "demo"))).toEqual({ status: "valid", datasetId: "demo", location: padded.location });
    expect(conceptHref(padded.location)).not.toContain("%20");
  });

  it("keeps inner spaces of a real course name and still rejects a blank one", () => {
    expect(parseConceptLocation("/?browse=course&course=%E6%95%B0%E6%8D%AE%20%E4%B8%8E%20%E7%AE%97%E6%B3%95")).toMatchObject({ status: "valid", location: { course: "数据 与 算法" } });
    expect(parseConceptLocation("/?browse=course&course=%20%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84%20")).toMatchObject({ status: "valid", location: { course: "数据结构" } });
    for (const url of ["/?browse=course&course=%20%20", "/?browse=home&term=%20%20"]) {
      expect(parseConceptLocation(url).status, url).toBe("invalid");
    }
  });

  it("treats drawing and term as views of the same topic, not as separate topics", () => {
    const topic = (drawing: "bars" | "dots" | "radar", term: string): ConceptLocation => ({ scene: "course", course: "数据结构", drawing, term });
    // Different drawing, same term → same key
    expect(conceptTopicKey(topic("dots", "2025J"))).toBe(conceptTopicKey(topic("bars", "2025J")));
    // Different term, same course → same key (term is a range switch, not identity)
    expect(conceptTopicKey(topic("bars", "2024J"))).toBe(conceptTopicKey(topic("bars", "2025J")));
    // Different course → different key
    expect(conceptTopicKey(topic("bars", "2025J"))).not.toBe(conceptTopicKey({ scene: "course", course: "线性代数", drawing: "bars", term: "2025J" }));
    // Different scene → different key
    expect(conceptTopicKey(topic("bars", "2025J"))).not.toBe(conceptTopicKey({ scene: "metric", course: "数据结构", metric: "score", relation: "dist", drawing: "dots", term: "2025J" }));
    // Home is always one topic regardless of drawing or term
    expect(conceptTopicKey({ scene: "home", drawing: "rank", term: "2025J" })).toBe(conceptTopicKey({ scene: "home", drawing: "dots" }));
  });

  it("does not interpret old cohort filters as a new unfiltered course topic", () => {
    expect(parseConceptLocation("/?browse=course&course=数据结构&focus=anything").status).toBe("invalid");
    expect(parseConceptLocation("/?browse=home&draft=anything").status).toBe("invalid");
  });

  it("only resolves browse addresses the workspace and source actually own", () => {
    expect(ownsBrowseLocation(conceptHref({ scene: "home", drawing: "rank" }, "demo"), "demo")).toBe(true);
    expect(ownsBrowseLocation("/?workspace=overview", "demo")).toBe(true);
    expect(ownsBrowseLocation("/?browse=home", "demo")).toBe(true);
    // Another workspace section owns its own entry and its own listener.
    expect(ownsBrowseLocation("/?workspace=analysis", "demo")).toBe(false);
    expect(ownsBrowseLocation("/?workspace=reports&primary=conversation", "demo")).toBe(false);
    expect(ownsBrowseLocation("/?workspace=admin&primary=explore", "demo")).toBe(false);
    expect(ownsBrowseLocation("/?workspace=account&primary=conversation", "demo")).toBe(false);
    // A browse address that names another source is that source's entry.
    expect(ownsBrowseLocation(conceptHref({ scene: "course", course: "数据结构", drawing: "bars" }, "oulad"), "demo")).toBe(false);
    expect(ownsBrowseLocation(conceptHref({ scene: "home", drawing: "rank" }, "oulad"), "oulad")).toBe(true);
  });
});
