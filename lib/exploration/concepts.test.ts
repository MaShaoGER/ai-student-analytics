import { describe, expect, it } from "vitest";
import type { ConceptExplorerData } from "../analysis/concept-explorer";
import { conceptHref, metricLocation, parseConceptLocation, type ConceptLocation } from "./concepts";

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

  it("does not interpret old cohort filters as a new unfiltered course topic", () => {
    expect(parseConceptLocation("/?browse=course&course=数据结构&focus=anything").status).toBe("invalid");
    expect(parseConceptLocation("/?browse=home&draft=anything").status).toBe("invalid");
  });
});
