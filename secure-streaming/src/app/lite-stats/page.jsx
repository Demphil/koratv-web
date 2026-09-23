import { absoluteUrl, SITE_NAME } from "../../lib/seo";

const referenceFacts = [
  { value: "2", label: "طرفان في المواجهة" },
  { value: "90", label: "دقيقة زمن اللعب الأساسي لكرة القدم" },
  { value: "3", label: "مؤشرات: النتيجة والتوقيت والحالة" }
];

export const metadata = {
  title: "ملخص المواجهات والإحصائيات الرياضية",
  description: "واجهة نصية موجزة لمواعيد المواجهات والنتائج والمؤشرات الرياضية الأساسية.",
  alternates: {
    canonical: absoluteUrl("/lite-stats")
  },
  openGraph: {
    title: "ملخص المواجهات والإحصائيات الرياضية",
    description: "معلومات ثابتة وموجزة حول النتائج والتوقيت والمؤشرات الرياضية.",
    siteName: SITE_NAME,
    url: absoluteUrl("/lite-stats"),
    type: "website"
  }
};

export default function LiteStatsPage() {
  return (
    <main className="lite-stats-page">
      <section className="lite-stats-content" aria-labelledby="lite-stats-title">
        <p className="lite-stats-eyebrow">ملخص رياضي</p>
        <h1 id="lite-stats-title">مواعيد المواجهات وملخص الأرقام</h1>
        <p className="lite-stats-intro">
          تعرض هذه الصفحة معلومات تعريفية ثابتة عن مؤشرات المباريات، دون مشغلات أو تحميل بيانات لحظية.
        </p>

        <dl className="lite-stats-grid">
          {referenceFacts.map((fact) => (
            <div className="lite-stat-card" key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>

        <a className="lite-stats-home-link" href={absoluteUrl("/")}>
          الانتقال إلى الموقع
        </a>
      </section>
    </main>
  );
}