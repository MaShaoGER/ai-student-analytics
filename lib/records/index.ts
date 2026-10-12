import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type AnalysisRecord } from "../analysis/types";

function recordsDirectory(): string {
  // Runtime records belong to the mounted state directory, never the build bundle.
  return path.resolve(/* turbopackIgnore: true */ process.env.ANALYSIS_RECORDS_DIR?.trim() || path.join(process.cwd(), "records"));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function saveAnalysisRecord(record: Omit<AnalysisRecord, "id" | "timestamp">): Promise<string> {
  const id = generateId();
  const timestamp = new Date().toISOString();
  const completeRecord: AnalysisRecord = {
    id,
    timestamp,
    ...record,
  };
  try {
    const directory = recordsDirectory();
    mkdirSync(directory, { recursive: true });
    appendFileSync(path.join(directory, "analysis.jsonl"), JSON.stringify(completeRecord) + "\n", "utf-8");
    return id;
  } catch (error) {
    console.error("Failed to save analysis record", error);
    throw new Error("Failed to persist analysis record");
  }
}

export function loadAnalysisRecords(): AnalysisRecord[] {
  try {
    const content = readFileSync(/* turbopackIgnore: true */ path.join(recordsDirectory(), "analysis.jsonl"), "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AnalysisRecord);
  } catch (error) {
    // File may not exist yet or be empty
    return [];
  }
}

export function findRecordById(id: string): AnalysisRecord | undefined {
  const records = loadAnalysisRecords();
  return records.find((r) => r.id === id);
}
