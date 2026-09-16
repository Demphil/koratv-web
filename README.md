كورة لايف | koora live منصة رياضية لمتابعة مباريات اليوم بث مباشر، مع تغطية فورية للأحداث، نتائج لحظية، وجداول مواعيد أبرز البطولات العربية والعالمية مع تفاصيل القنوات الناقلة.

https://koratv.click

## Match Metadata

This repository keeps match discovery separate from stream delivery. Match metadata can still be refreshed with:

```bash
npm run matches:metadata
```

The legacy stream resolver and external-source QA pipeline were removed. Live channel links are now managed by the secure streaming service under `secure-streaming`, where provider M3U updates refresh sports channels only.

## SEO Maintenance

Run the SEO updater after changing public pages:

```bash
npm run seo:apply
npm run seo:check
```

The generated static pages keep canonical URLs, Arabic/x-default alternates, sitemap entries, structured data, and Monetag-only ad scripts.
