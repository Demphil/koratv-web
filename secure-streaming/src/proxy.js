import { NextResponse } from "next/server";

function approvedFrameAncestors() {
  const configured = Array.from(new Set([
    process.env.PUBLIC_SITE_ORIGIN || "",
    ...(process.env.APPROVED_IFRAME_ORIGINS || "").split(",")
  ]
    .map((item) => item.trim())
    .filter(Boolean)))
    .join(" ");

  return configured ? `'self' ${configured}` : "'self'";
}

export function proxy(request) {
  const response = NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/embed/")) {
    response.headers.set("Content-Security-Policy", `frame-ancestors ${approvedFrameAncestors()};`);
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-Content-Type-Options", "nosniff");
  }
  return response;
}

export const config = {
  matcher: ["/embed/:path*"]
};
