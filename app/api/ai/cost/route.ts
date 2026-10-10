import { NextResponse } from "next/server";
import { getCostStats } from "@/lib/security/ai-cost";

export const runtime = "nodejs";

export async function GET() {
  try {
    const stats = getCostStats();
    return NextResponse.json({
      stats: {
        totalCalls: stats.total,
        lastHour: {
          totalCost: stats.lastHour.totalCost.toFixed(4),
          currency: stats.lastHour.currency,
        },
        last24Hours: {
          totalCost: stats.last24h.totalCost.toFixed(4),
          currency: stats.last24h.currency,
        },
        byModel: Object.entries(stats.byModel).map(([model, data]) => ({
          model,
          calls: data.calls,
          totalCost: data.totalCost.toFixed(4),
        })),
      },
    });
  } catch (error) {
    console.error("Failed to get cost stats", error);
    return NextResponse.json(
      { error: "无法获取成本统计" },
      { status: 500 }
    );
  }
}
