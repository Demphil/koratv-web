import { NextResponse } from "next/server";

const AUTOMATED_USER_AGENT_PATTERNS = [
  /googlebot|bingbot|duckduckbot|baiduspider|yandexbot|slurp|applebot|petalbot|sogou|exabot/i,
  /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|pinterestbot/i,
  /ahrefsbot|semrushbot|mj12bot|dotbot|bytespider|gptbot|claudebot|ccbot|perplexitybot/i,
  /headlesschrome|phantomjs|selenium|playwright|puppeteer|nightmare|cypress|webdriver/i,
  /curl\/|wget\/|python-requests|python-urllib|scrapy|httpx|aiohttp|go-http-client|node-fetch|undici|okhttp|postmanruntime/i
];

const STANDARD_BROWSER_USER_AGENT = /(?:chrome|crios|chromium|edg|edgios|opr|firefox|fxios|safari|samsungbrowser|vivaldi|yabrowser)\//i;

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

function isAutomatedRequest(request) {
  const userAgent = request.headers.get("user-agent") || "";
  if (AUTOMATED_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))) return true;

  const fetchDestination = request.headers.get("sec-fetch-dest") || "";
  const acceptLanguage = request.headers.get("accept-language") || "";
  const acceptsHtml = /text\/html/i.test(request.headers.get("accept") || "");
  const isDocumentNavigation = fetchDestination === "document"
    || fetchDestination === "iframe"
    || (!fetchDestination && acceptsHtml);

  return !(STANDARD_BROWSER_USER_AGENT.test(userAgent)
    && isDocumentNavigation
    && acceptsHtml
    && acceptLanguage.trim());
}

function setEmbedSecurityHeaders(response) {
  response.headers.set("Content-Security-Policy", `frame-ancestors ${approvedFrameAncestors()};`);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function proxy(request) {
  const pathname = request.nextUrl.pathname;
  const isEmbedRoute = pathname.startsWith("/embed/");
  const acceptsHtml = /text\/html/i.test(request.headers.get("accept") || "");

  if (pathname !== "/lite-stats"
    && (request.method === "GET" || request.method === "HEAD")
    && acceptsHtml
    && isAutomatedRequest(request)) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = "/lite-stats";
    const response = NextResponse.rewrite(rewriteUrl);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append("Vary", "User-Agent, Sec-Fetch-Dest, Accept-Language");
    if (isEmbedRoute) setEmbedSecurityHeaders(response);
    return response;
  }

  const response = NextResponse.next();
  if (isEmbedRoute) setEmbedSecurityHeaders(response);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[^/]+$).*)"]
};
