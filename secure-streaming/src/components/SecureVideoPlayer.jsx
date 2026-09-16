"use client";

import { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import "@videojs/http-streaming";

const QUALITY_OPTIONS = [
  { id: "1080p", type: "quality", label: "سيرفر 1", sub: "1080 HD", file: "1080p.m3u8" },
  { id: "720p", type: "quality", label: "سيرفر 2", sub: "720 HD", file: "720p.m3u8" },
  { id: "360p", type: "quality", label: "سيرفر 3", sub: "360 SD", file: "360p.m3u8" }
];

const DEFAULT_AD_SCRIPTS = [
  { src: "https://al5sm.com/tag.min.js", zone: "11638896" },
  { src: "https://quge5.com/88/tag.min.js", zone: "260051", cfasync: "false" },
  { src: "https://nap5k.com/tag.min.js", zone: "11639220" }
];

function configuredAdScripts() {
  const custom = (process.env.NEXT_PUBLIC_MONETAG_SCRIPT_URLS || "")
    .split(",")
    .map((src) => src.trim())
    .filter(Boolean)
    .map((src) => ({ src }));
  return custom.length ? custom : DEFAULT_AD_SCRIPTS;
}

function buildAbrSrc(channelName, server, token) {
  const selected = server?.file ? server : QUALITY_OPTIONS.find((item) => item.id === server) || QUALITY_OPTIONS[0];
  return `/api/abr/${encodeURIComponent(channelName)}/${selected.file}?token=${encodeURIComponent(token)}`;
}

function parentOrigin() {
  if (!document.referrer) return "";
  try {
    return new URL(document.referrer).origin;
  } catch {
    return "";
  }
}

function opaqueWatchId(value) {
  let hash = 0x811c9dc5;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return String(hash).padStart(10, "0");
}

export default function SecureVideoPlayer({ channelName, matchId = "", publicStreamId = "", embed = false, abr = true }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const tokenRef = useRef("");
  const activeChannelRef = useRef(channelName);
  const [selectedServerId, setSelectedServerId] = useState("1080p");
  const [languageServers, setLanguageServers] = useState([]);
  const [blocked, setBlocked] = useState("");
  const [adNotice, setAdNotice] = useState("");
  const [promoOpen, setPromoOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let loaded = 0;
    const scripts = configuredAdScripts().map((item) => {
      const script = document.createElement("script");
      script.src = item.src;
      script.async = true;
      if (item.zone) script.dataset.zone = item.zone;
      if (item.cfasync) script.dataset.cfasync = item.cfasync;
      script.onload = () => { loaded += 1; };
      script.onerror = () => {
        setBlocked("يرجى تعطيل مانع الإعلانات لتشغيل البث. الإعلانات جزء من حماية الخدمة واستمرارها.");
      };
      document.head.appendChild(script);
      return script;
    });

    const timer = window.setTimeout(() => {
      if (scripts.length && loaded === 0) {
        setBlocked("يرجى تعطيل مانع الإعلانات لتشغيل البث. الإعلانات جزء من حماية الخدمة واستمرارها.");
      }
    }, 5500);

    return () => {
      window.clearTimeout(timer);
      scripts.forEach((script) => script.remove());
    };
  }, [embed]);

  useEffect(() => {
    let disposed = false;
    async function loadAlternatives() {
      try {
        const query = matchId ? `?matchId=${encodeURIComponent(matchId)}` : "";
        const response = await fetch(`/api/channel-alternatives/${encodeURIComponent(channelName)}${query}`, {
          credentials: "include"
        });
        if (!response.ok) return;
        const data = await response.json();
        const nextServers = (data.alternatives || [])
          .filter((item) => item.language === "fr" || item.language === "en")
          .map((item) => ({
            id: `lang-${item.language}`,
            type: "language",
            label: item.language.toUpperCase(),
            sub: item.language === "fr" ? "Audio FR" : "Audio EN",
            file: "720p.m3u8",
            channelName: item.channelName
          }));
        if (!disposed) setLanguageServers(nextServers);
      } catch {
        if (!disposed) setLanguageServers([]);
      }
    }
    loadAlternatives();
    return () => {
      disposed = true;
    };
  }, [channelName, matchId]);

  useEffect(() => {
    const bait = document.createElement("div");
    bait.className = "adsbox ad-banner ad-unit pub_300x250";
    bait.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;";
    document.body.appendChild(bait);

    const timer = window.setTimeout(() => {
      const style = window.getComputedStyle(bait);
      if (bait.offsetParent === null || style.display === "none" || style.visibility === "hidden") {
        setBlocked("تم اكتشاف مانع إعلانات. يرجى تعطيله ثم تحديث الصفحة لتشغيل البث.");
      }
      bait.remove();
    }, 1200);

    return () => {
      window.clearTimeout(timer);
      bait.remove();
    };
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => setPromoOpen(true), 2500);
    const every = window.setInterval(() => setPromoOpen(true), 8 * 60 * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  useEffect(() => {
    if (!embed || !videoRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      const box = entry.boundingClientRect;
      if (!entry.isIntersecting || box.width < 240 || box.height < 140) {
        setBlocked("تم إيقاف البث لأن إطار المشاهدة غير ظاهر بشكل صحيح.");
      }
    }, { threshold: 0.35 });
    observer.observe(videoRef.current);
    return () => observer.disconnect();
  }, [embed]);

  useEffect(() => {
    let disposed = false;

    async function issueToken(targetChannelName = channelName) {
      const response = await fetch("/api/stream-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channelName: targetChannelName, embed, parentOrigin: embed ? parentOrigin() : undefined })
      });
      if (!response.ok) throw new Error("token");
      const data = await response.json();
      tokenRef.current = data.token;
      activeChannelRef.current = targetChannelName;
      return data;
    }

    async function boot() {
      const data = await issueToken();
      const src = abr ? buildAbrSrc(channelName, QUALITY_OPTIONS[0], data.token) : data.streamUrl;
      if (disposed || !videoRef.current) return;

      playerRef.current = videojs(videoRef.current, {
        controls: true,
        autoplay: false,
        preload: "auto",
        fluid: true,
        liveui: true,
        html5: {
          vhs: {
            overrideNative: true,
            enableLowInitialPlaylist: false
          }
        },
        sources: [{ src, type: "application/x-mpegURL" }]
      });
    }

    boot().catch(() => setBlocked("تعذر تشغيل البث الآمن."));
    return () => {
      disposed = true;
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [channelName, abr]);

  useEffect(() => {
    if (!playerRef.current || !abr) return;
    const allServers = [...QUALITY_OPTIONS, ...languageServers];
    const selected = allServers.find((item) => item.id === selectedServerId) || QUALITY_OPTIONS[0];
    const targetChannelName = selected.channelName || channelName;

    async function switchServer() {
      try {
        const response = await fetch("/api/stream-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ channelName: targetChannelName, embed, parentOrigin: embed ? parentOrigin() : undefined })
        });
        if (!response.ok) throw new Error("token");
        const data = await response.json();
        tokenRef.current = data.token;
        activeChannelRef.current = targetChannelName;
        const wasPaused = playerRef.current.paused();
        playerRef.current.src({ src: buildAbrSrc(targetChannelName, selected, data.token), type: "application/x-mpegURL" });
        if (!wasPaused) playerRef.current.play().catch(() => {});
      } catch {
        setBlocked("تعذر تشغيل هذا السيرفر الآن.");
      }
    }

    switchServer();
  }, [selectedServerId, languageServers, channelName, embed, abr]);

  useEffect(() => {
    if (blocked && playerRef.current) playerRef.current.pause();
  }, [blocked]);

  useEffect(() => {
    const protectedSelectors = [".korlive-corner-logo", ".brand-watermark"];
    const isHidden = (element) => {
      if (!element) return true;
      const style = window.getComputedStyle(element);
      return style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.15;
    };

    const checkProtection = () => {
      const tampered = protectedSelectors.some((selector) => isHidden(document.querySelector(selector)));
      if (tampered) setBlocked("تم إيقاف البث بسبب تعديل عناصر الحماية داخل المشغل.");
    };

    const observer = new MutationObserver(() => {
      checkProtection();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden"]
    });

    const timer = window.setInterval(checkProtection, 2200);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  async function refreshStream() {
    try {
      const response = await fetch("/api/stream-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channelName: activeChannelRef.current, embed, parentOrigin: embed ? parentOrigin() : undefined })
      });
      const data = await response.json();
      tokenRef.current = data.token;
      if (playerRef.current) {
        const allServers = [...QUALITY_OPTIONS, ...languageServers];
        const selected = allServers.find((item) => item.id === selectedServerId) || QUALITY_OPTIONS[0];
        playerRef.current.src({ src: buildAbrSrc(activeChannelRef.current, selected, data.token), type: "application/x-mpegURL" });
        playerRef.current.play().catch(() => {});
      }
    } catch {
      setBlocked("تعذر تحديث البث الآن.");
    }
  }

  const brandUrl = process.env.NEXT_PUBLIC_BRAND_URL || "https://koratv.click";
  const embedId = publicStreamId || opaqueWatchId(matchId || channelName);
  const embedUrl = `${brandUrl.replace(/\/$/, "")}/embed/${encodeURIComponent(embedId)}`;
  const embedCode = `<iframe src="${embedUrl}" width="100%" height="500" frameborder="0" sandbox="allow-scripts allow-same-origin allow-presentation" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;

  async function copyEmbedCode() {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function goHome(event) {
    event.preventDefault();
    window.location.assign(brandUrl);
  }

  function selectServer(event, id) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedServerId(id);
  }

  return (
    <div className="secure-player-shell">
      <div className="player-topbar">
        <a className="header-logo" href={brandUrl} target="_blank" rel="noreferrer" aria-label="KoraLive football">
          <strong>KORALIVE</strong><span>.football</span>
        </a>
        <div className="quality-tabs" aria-label="اختيار سيرفر المشاهدة">
          {[...QUALITY_OPTIONS, ...languageServers].map((item) => (
            <button
              key={item.id}
              type="button"
              className={selectedServerId === item.id ? "active" : ""}
              onClick={(event) => selectServer(event, item.id)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span>{item.label}</span>
              <small>{item.sub}</small>
            </button>
          ))}
        </div>
        <div className="topbar-actions">
          {!embed ? (
            <a className="back-site-btn" href={brandUrl} onClick={goHome}>العودة للموقع</a>
          ) : null}
          {!embed ? (
            <button type="button" className="embed-open-btn" onClick={() => setEmbedOpen(true)} aria-label="كود التضمين">
              <span aria-hidden="true">&lt;/&gt;</span>
              <strong>Embed</strong>
            </button>
          ) : null}
        </div>
      </div>

      {adNotice ? <div className="adblock-note">{adNotice}</div> : null}

      <div data-vjs-player className="secure-video-frame">
        <video ref={videoRef} className="video-js vjs-big-play-centered" playsInline />

        <button type="button" className="player-refresh" onClick={refreshStream} aria-label="تحديث البث">↻</button>

        <div className="korlive-corner-logo" aria-hidden="true">
          <strong>KORALIVE</strong>
          <small>.football</small>
        </div>

        <div className="brand-watermark bottom-line">
          <span>مرحبا بك في {brandUrl} - استمتع بالمشاهدة ولا تنس تجربة سيرفر آخر إذا توقف البث</span>
        </div>

        {promoOpen ? (
          <aside className="promo-pop" aria-label="إعلان">
            <button type="button" className="promo-close" onClick={() => setPromoOpen(false)} aria-label="إغلاق الإعلان">×</button>
            <div className="promo-badge">🏆 بث مباشر بجودة عالية</div>
            <h3>تابع المباريات على KoraLive</h3>
            <p>إذا واجهت تقطيعاً، بدّل السيرفر من الأعلى أو اضغط تحديث البث.</p>
            <a href={brandUrl} target="_blank" rel="noreferrer">زيارة الموقع</a>
          </aside>
        ) : null}

        {blocked ? <div className="player-block-overlay">{blocked}</div> : null}
      </div>

      {embedOpen ? (
        <div className="embed-modal" role="dialog" aria-modal="true" aria-label="كود تضمين المشغل">
          <div className="embed-modal-card">
            <button type="button" className="embed-close" onClick={() => setEmbedOpen(false)} aria-label="إغلاق">×</button>
            <h2>كود تضمين البث</h2>
            <p>انسخ هذا الكود وضعه في أي صفحة تريد عرض المشغل داخلها.</p>
            <textarea readOnly value={embedCode} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="copy-embed-btn" onClick={copyEmbedCode}>
              {copied ? "تم النسخ" : "Copy Code"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
