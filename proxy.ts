import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const NOINDEX = "noindex, nofollow";

// 仅开发环境放行预览路由；其余环境一律 404，不提供可重新打开的开关。
export function proxy(_request: NextRequest) {
  if (process.env.NODE_ENV === "development") {
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", NOINDEX);
    return response;
  }
  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": NOINDEX,
    },
  });
}

export const config = {
  matcher: ["/preview/:path*", "/previews/:path*"],
};
