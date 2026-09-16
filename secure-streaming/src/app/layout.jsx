import "./style.css";
import { absoluteUrl, CANONICAL_ORIGIN, SITE_NAME } from "../lib/seo";

export const metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN),
  title: {
    default: "KoraLive - Watch Live Football Matches Today",
    template: `%s | ${SITE_NAME}`
  },
  description: "KoraLive Football brings today's live football matches, secure match pages, Arabic sports coverage, and multi-quality streaming options in one fast experience.",
  keywords: [
    "KoraLive",
    "كورة لايف",
    "live football",
    "مشاهدة مباريات اليوم",
    "football live stream",
    "بث مباشر مباريات"
  ],
  alternates: {
    canonical: absoluteUrl("/")
  },
  openGraph: {
    type: "website",
    locale: "ar_MA",
    siteName: SITE_NAME,
    url: CANONICAL_ORIGIN,
    title: "KoraLive - Watch Live Football Matches Today",
    description: "Follow today's football matches live with updated schedules, channels, and secure multi-quality viewing pages.",
    images: [{ url: absoluteUrl("/assets/images/logo.png"), width: 512, height: 512, alt: SITE_NAME }]
  },
  twitter: {
    card: "summary_large_image",
    title: "KoraLive - Watch Live Football Matches Today",
    description: "Live football match pages, updated schedules, channels, and multi-quality viewing.",
    images: [absoluteUrl("/assets/images/logo.png")]
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1
    }
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
