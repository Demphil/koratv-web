import { headers } from "next/headers";
import SecureVideoPlayer from "../../../components/SecureVideoPlayer";
import { isEmbedRequestAllowed } from "../../../lib/security";
import { getEmbedTarget, publicWatchIdFor } from "../../../lib/seo";

export default async function EmbedPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const requestHeaders = await headers();
  const routeToken = decodeURIComponent(resolvedParams.channelName);
  const matchId = resolvedSearchParams?.matchId || "";
  const target = await getEmbedTarget({ routeToken, matchId });
  const channelName = target.channelName || routeToken;
  const publicStreamId = publicWatchIdFor({ channelName, matchId: matchId || target.match?.match_id || target.match?.id || "" });

  if (!isEmbedRequestAllowed(requestHeaders)) {
    return (
      <main className="embed-page">
        <section className="player-card">
          <div className="player-block-overlay static-lock">
            هذا النطاق غير مصرح له بتضمين مشغل koratv.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="embed-page">
      <section className="player-card">
        <div className="alert-box">تنبيه: إذا توقف البث أو واجهت تقطيعاً، يرجى تجربة سيرفر أو جودة أخرى.</div>
        <SecureVideoPlayer channelName={channelName} matchId={matchId || target.match?.match_id || ""} publicStreamId={publicStreamId} embed />
      </section>
    </main>
  );
}
