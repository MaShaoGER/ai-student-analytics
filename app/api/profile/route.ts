import { NextResponse } from "next/server";
import { profileDatasets } from "@/lib/analysis/duckdb";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ datasets: await profileDatasets() });
}
