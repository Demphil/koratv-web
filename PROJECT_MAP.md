# خريطة ملفات المشروع

هذا المستند يشرح بنية المستودع ومسؤولية الملفات المهمة. الخريطة مبنية على الملفات الموجودة حاليًا؛ لا تشمل مجلدات الاعتماديات أو البناء مثل `node_modules/` و`.next/` و`dist/`، ولا تعرض محتويات ملفات البيئة أو الأسرار.

## نظرة عامة

- صفحات الموقع العامة وملفات الواجهة الثابتة موجودة في جذر المشروع وداخل `assets/`.
- `functions/api/matches.js` واجهة Cloudflare لقراءة بيانات المباريات من Supabase.
- `qa-media/` يجمع بيانات المباريات الوصفية ويحفظها في Supabase.
- `secure-streaming/` مشروع Next.js مستقل وأدوات لإدارة القنوات وبيانات البث.
- `streaming-gateway/` بوابة Express مستقلة؛ إعداد الإنتاج يستخدم Redis، وتوجد إعدادات PM2 في `ecosystem.config.js`.

## شجرة المشروع

```text
.
├── index.html                         الصفحة الرئيسية وجدول المباريات
├── news.html                          صفحة الأخبار
├── watch.html                         صفحة المشاهدة
├── 404.html                           صفحة عدم العثور على الصفحة
├── yalla-shoot-tv.html                صفحة ثابتة باسم Yalla Shoot TV
├── yalla-live.html                    صفحة ثابتة باسم Yalla Live
├── kooracity.html                     صفحة ثابتة باسم Kooracity
├── kora-online.html                   صفحة ثابتة باسم Kora Online
├── koora-extra.html                   صفحة ثابتة باسم Koora Extra
├── yall-extra.html                    صفحة ثابتة باسم Yall Extra
├── buzkora.html                       صفحة ثابتة باسم Buzkora
├── yalla-shoot-hd.html                صفحة ثابتة باسم Yalla Shoot HD
├── yalla-shoot-today.html             صفحة ثابتة باسم Yalla Shoot Today
├── yacine-tv.html                     صفحة ثابتة باسم Yacine TV
├── sir-tv.html                        صفحة ثابتة باسم Sir TV
├── syria-live-tv.html                 صفحة ثابتة باسم Syria Live TV
├── usecase.html                       صفحة ثابتة إضافية
├── 64b5f9a890.php                     ملف PHP في الجذر؛ وظيفته غير موثقة في README
├── cloudflare-channel-links.csv       ملف بيانات CSV متعلق بروابط القنوات
├── CNAME                              إعداد اسم النطاق للاستضافة الثابتة
├── robots.txt                         تعليمات الزحف لمحركات البحث
├── sitemap.xml                        خريطة روابط الموقع لمحركات البحث
├── sw.js                              Service Worker للواجهة
├── ecosystem.config.js                تعريف تطبيقات PM2 على الخادم
├── VPS_SETUP.md                       خطوات إعداد خادم الإنتاج
├── package.json                       أوامر المشروع واعتماديات الجذر
├── package-lock.json                  قفل اعتماديات الجذر
├── .gitignore                         قواعد استثناء الملفات من Git
├── skills-lock.json                   قفل إصدارات المهارات المثبتة
├── google7d068dd4004f9e8d.html        ملف تحقق لمزود خارجي
├── pinterest-83dc7.html               ملف تحقق لـ Pinterest
├── hta-code-7346521.txt               ملف تحقق نصي
├── ppck-ver-6fd486d10f98484db716dc155186752e.txt  ملف تحقق نصي
├── README.md                          تعريف المشروع وأوامر الصيانة
│
├── .agents/
│   └── skills/supabase-server/SKILL.md تعليمات محلية لمهارة Supabase
├── .github/workflows/                 مهام GitHub Actions الآلية
│   ├── deploy.yml                     سير عمل النشر
│   ├── indexnow.yml                   سير عمل إرسال الروابط إلى IndexNow
│   ├── sync-iptv.yml                  سير عمل مزامنة IPTV
│   └── sync-matches.yml               سير عمل مزامنة المباريات
│
├── abroad/index.html                  نسخة واجهة ضمن مسار abroad
├── at-work/index.html                 نسخة واجهة ضمن مسار at-work
├── low-internet/index.html            نسخة واجهة ضمن مسار low-internet
├── smart-tv/index.html                نسخة واجهة ضمن مسار smart-tv
├── shahid-vip/index.html              صفحة ضمن مسار shahid-vip
│
├── assets/                            ملفات الواجهة الثابتة
│   ├── css/
│   │   ├── main.css                   تنسيقات الواجهة الرئيسية
│   │   ├── matches.css                تنسيقات المباريات
│   │   ├── news.css                   تنسيقات الأخبار
│   │   ├── watch.css                  تنسيقات المشاهدة
│   │   └── footer.css                 تنسيقات التذييل
│   ├── js/
│   │   ├── api.js                     طلبات بيانات الواجهة
│   │   ├── current-date.js            وظائف التاريخ الحالي
│   │   ├── main.js                    سلوك الواجهة الرئيسية
│   │   ├── matches.js                 عرض وتحديث المباريات
│   │   ├── news.js                    عرض الأخبار
│   │   ├── streams.js                 بيانات/وظائف القنوات والبث للواجهة
│   │   ├── watch.js                   سلوك صفحة المشاهدة
│   │   ├── supabase-config.js         إعداد عميل Supabase للواجهة
│   │   └── proxy.php                  ملف PHP قديم ضمن أصول JavaScript
│   └── images/                        الشعارات والصور الافتراضية وصور البطولات
│
├── data/
│   └── matches.json                   ملف JSON لبيانات المباريات
├── functions/
│   └── api/
│       └── matches.js                 نقطة API للمباريات؛ تقرأ Supabase وتنسق النتائج
├── shared/
│   └── league-whitelist.mjs           قائمة/قواعد الدوريات المشتركة مع بوابة البث
├── scripts/                           أدوات إدارة وصيانة الموقع
│   ├── apply-seo.js                   تطبيق تحديثات SEO على الصفحات
│   ├── check-seo.js                    فحص بيانات SEO
│   ├── submit-indexnow.js             إرسال تحديثات الروابط إلى IndexNow
│   └── test-player-ui.cjs              اختبار واجهة المشغل
│
├── qa-media/                          جمع بيانات المباريات الوصفية وتخزينها
│   ├── index.js                       نقطة تشغيل المشروع
│   ├── metadata-scraper.js            استخراج بيانات جدول المباريات
│   ├── config.js                      إعدادات أداة الجمع
│   ├── supabase.js                    تهيئة Supabase
│   ├── supabase-storage.js            حفظ بيانات المراجعة/المرحلة في Supabase
│   └── supabase-schema.sql             مخطط قاعدة البيانات المستخدم هنا
│
├── secure-streaming/                  تطبيق Next.js وأدوات إدارة بيانات البث
│   ├── .env.example                   أسماء وقيم إرشادية لإعداد البيئة، دون أسرار حقيقية
│   ├── next.config.js                  إعداد Next.js
│   ├── package.json                   أوامر واعتماديات تطبيق البث
│   ├── package-lock.json              قفل اعتماديات تطبيق البث
│   ├── README.md                      تعليمات التشغيل والتحديث
│   ├── src/
│   │   ├── proxy.js                   وسيط/إعداد اعتراض طلبات التطبيق
│   │   ├── app/
│   │   │   ├── layout.jsx             التخطيط العام لتطبيق Next.js
│   │   │   ├── page.jsx               الصفحة الرئيسية للتطبيق
│   │   │   ├── style.css              تنسيقات التطبيق
│   │   │   └── api/stream-token/route.js إصدار رمز مؤقت لطلب البث
│   │   ├── components/
│   │   │   ├── SecureVideoPlayer.jsx  مكوّن تشغيل الفيديو
│   │   │   └── WatchNews.jsx          مكوّن أخبار/محتوى صفحة المشاهدة
│   │   └── lib/
│   │       ├── channelStore.js        الوصول إلى بيانات القنوات
│   │       ├── geminiChannelResolver.js حل/اقتراح القنوات باستخدام Gemini
│   │       ├── hlsProxy.js            وظائف وسيط HLS
│   │       ├── loadEnv.js              تحميل إعدادات البيئة
│   │       ├── security.js             وظائف التحقق والرموز الأمنية
│   │       ├── seo.js                  وظائف SEO
│   │       └── supabaseAdmin.js        عميل Supabase بصلاحيات الخادم
│   ├── scripts/                       استيراد ومزامنة واختبار بيانات البث
│   │   ├── import-m3u.js               استيراد قائمة M3U
│   │   ├── refresh-streaming-data.js   تشغيل مسار تحديث بيانات البث
│   │   ├── sync-iptv-provider.js       مزامنة القنوات من المزود
│   │   ├── sync-iptv-links.js          مزامنة روابط القنوات
│   │   ├── sync-matches-from-source.js مزامنة المباريات من المصدر
│   │   ├── sync-matches-daily.js       مزامنة يومية للمباريات
│   │   ├── daily-refresh-cron.js       مهمة التحديث اليومية المجدولة
│   │   ├── iptv-provider-cron.js       جدولة مزامنة مزود IPTV
│   │   ├── match-sync-cron.js          جدولة مزامنة المباريات
│   │   ├── enrich-match-language-channels.js إثراء بيانات اللغات والقنوات
│   │   ├── export-local-channels.js    تصدير القنوات المحلية
│   │   ├── investigate-iptv-qualities.js فحص جودات IPTV
│   │   ├── trusted-broadcast-sources.js مصادر البث الموثوقة
│   │   ├── check-supabase-setup.js     التحقق من إعداد Supabase
│   │   ├── test-streams.js             اختبار بيانات/روابط البث
│   │   └── disable-gemini-channel-suggestions.js تعطيل اقتراحات Gemini
│   └── supabase/migrations/            ترحيلات مخطط قاعدة بيانات Supabase
│       ├── 001_channels.sql
│       ├── 002_channel_language_alternatives.sql
│       ├── 003_matches.sql
│       ├── 004_match_specific_channel_alternatives.sql
│       └── 005_channel_quality_variants.sql
│
└── streaming-gateway/                  بوابة Express وواجهة مشغل معزولة
    ├── .env.example                    نموذج إعدادات البيئة
    ├── .env.oracle.example             نموذج إعدادات OCI قديم/بديل
    ├── .gitignore                      قواعد استثناء خاصة بالبوابة
    ├── package.json                    أوامر واعتماديات البوابة
    ├── package-lock.json               قفل اعتماديات البوابة
    ├── README.md                       دليل النشر والتشغيل والأمان
    ├── SEO-ACCESS.md                   ملاحظات الوصول وSEO
    ├── ORACLE_WATCH_PROXY.md           توثيق مسار/إعداد Oracle القديم
    ├── server.js                        تشغيل Express وRedis وإغلاق منظم
    ├── app.js                           المسارات ومنطق API ووساطة HLS
    ├── config.js                        قراءة والتحقق من إعدادات البوابة
    ├── anti-bot.js                      وسيط مكافحة الطلبات الآلية
    ├── client-ip.js                     تحديد عنوان العميل عبر الوكلاء الموثوقين
    ├── supabase.js                      الوصول إلى Supabase
    ├── nginx.conf.example               مثال إعداد Nginx للإنتاج
    ├── nginx.oracle.conf.example        مثال Nginx لمسار Oracle
    ├── player/
    │   ├── player.html                  مستند واجهة المشغل
    │   ├── player.css                   تنسيقات المشغل
    │   └── player.js                    منطق واجهة المشغل
    ├── scripts/
    │   ├── build-player.js              بناء ملفات المشغل
    │   ├── setup-env.js                 تجهيز ملفات البيئة
    │   ├── check-supabase.js            فحص اتصال/إعداد Supabase
    │   ├── add-upstream-origin.js       إضافة مصدر إلى قائمة المصادر المسموحة
    │   └── seed-live-match.js            تجهيز مباراة مباشرة للاختبار
    ├── supabase/
    │   ├── live_matches.sql             مخطط بيانات المباريات المباشرة
    │   └── stream_sources.sql            مخطط مصادر البث
    └── test/                             اختبارات البوابة والمشغل
        ├── anti-bot.test.js
        ├── client-ip.test.js
        ├── config.test.js
        ├── gateway.test.js
        ├── league-whitelist.test.js
        └── player-navigation.test.js
```

## أوامر العمل الشائعة

الأوامر التالية معرفة في ملفات `package.json`، ويجب تشغيل كل منها من جذر المشروع ما لم يُذكر خلاف ذلك:

| الأمر | الاستخدام |
|---|---|
| `npm run matches:metadata` | تشغيل جمع بيانات المباريات مرة واحدة |
| `npm run seo:apply` | تحديث بيانات SEO للصفحات العامة |
| `npm run seo:check` | فحص إعدادات SEO |
| `npm run refresh:streaming:dry` | تجربة مسار تحديث البث دون تطبيق التغييرات |
| `npm --prefix secure-streaming run refresh:manual:dry` | تجربة التحديث اليدوي من مشروع البث |
| `npm --prefix streaming-gateway test` | تشغيل اختبارات بوابة البث |
| `npm --prefix streaming-gateway run build:player` | بناء ملفات المشغل |

## ملاحظات مهمة

- ملف `.env.example` نموذج إعداد فقط؛ لا تضع القيم السرية في هذا المستند أو في ملفات الواجهة العامة.
- يوجد مشروعان منفصلان لـ `secure-streaming/` و`streaming-gateway/`، ولكل منهما `package.json` وأوامر واعتماديات خاصة.
- يذكر `secure-streaming/README.md` بعض صفحات ومسارات API لا تظهر كملفات في الجرد الحالي. اعتمد على الشجرة الموجودة عند البحث عن التنفيذ، وراجع README عند صيانة توثيق المسارات.
- الملفات المسماة `abroad/` و`at-work/` و`low-internet/` و`smart-tv/` و`shahid-vip/` تحتوي حاليًا على صفحة `index.html` لكل مسار؛ وصف الغرض التفصيلي للنسخ يحتاج مراجعة محتوى كل صفحة.