# النسخ الاحتياطي والاستعادة والرجوع

## 1. النسخة المرجعية الحالية

تم إنشاء فرع GitHub مستقل قبل إضافة ملفات التوثيق:

- المستودع: `jokstream-site/jokstream`
- الفرع: `backup/known-good-2026-11-21`
- commit المرجعي: `1756ea5bfc9219f37eb368e221036caefae5776e`
- هذا الفرع يشير إلى حالة الموقع قبل إدخال التوثيق، وليس نسخة من أسرار Cloudflare أو قواعد البيانات.
- سجل المرجع التفصيلي في [KNOWN-GOOD-BASELINE.md](KNOWN-GOOD-BASELINE.md).

**لا تحذف فرع backup.** اتركه كمرجع استعادة مستقل.

## 2. متى نرجع؟
ارجع عندما:
- يتعطل الموقع بعد تغيير محدد.
- تختفي وظيفة كانت تعمل قبل التغيير.
- يتعذر تحديد سبب regression بسرعة.
- يظهر اختلاف غير مقصود بين ملفات GitHub والـ Worker المنشور.

لا تستخدم rollback كحل أول إذا كان الخلل من مزود خارجي متوقف أو من API غير متاح. تحقق من الخدمات أولاً.

## 3. استعادة ملفات GitHub من الفرع المرجعي — الطريقة الآمنة

الطريقة المفضلة للمستخدم الذي لا يريد أوامر Git:
1. افتح المستودع `jokstream-site/jokstream` في GitHub.
2. افتح الفرع `backup/known-good-2026-11-21`.
3. قارن الملف المتضرر مع نفس الملف في backup.
4. استعد فقط الملفات التي تغيرت وتسببت بالمشكلة، لا تستبدل كل الملفات بلا حاجة.
5. افتح Pull Request أو أنشئ commit واضحاً على main.
6. راجع diff قبل الدمج.

رابط الفرع:
https://github.com/jokstream-site/jokstream/tree/backup/known-good-2026-11-21

### الاستعادة الكاملة إلى commit المرجعي
إذا كان المطلوب إرجاع المشروع كله:
- أنشئ فرع إصلاح جديد من commit المرجعي، أو استخدم GitHub Revert للـ commits اللاحقة إذا كانت التغييرات متسلسلة.
- لا تعمل force push إلى main.
- لا تحذف تاريخ commits؛ التاريخ هو سجل التغييرات.
- راجع أي تغييرات مفيدة أضيفت بعد النسخة المرجعية قبل إسقاطها.

## 4. الاستعادة عبر Git CLI (للمطور)

استنساخ نسخة المرجع:
```bash
git clone https://github.com/jokstream-site/jokstream.git
cd jokstream
git fetch origin
git checkout backup/known-good-2026-11-21
```

إنشاء فرع إصلاح من المرجع:
```bash
git checkout -b recovery/restore-known-good backup/known-good-2026-11-21
```

مقارنة main بالنسخة المرجعية:
```bash
git diff --stat backup/known-good-2026-11-21..origin/main
git diff backup/known-good-2026-11-21..origin/main -- app.js index.html style.css
```

استعادة ملف واحد إلى نسخة المرجع:
```bash
git checkout backup/known-good-2026-11-21 -- app.js
git diff -- app.js
git add app.js
git commit -m "Restore app.js from known-good baseline"
```

استعادة الواجهة كاملة على فرع إصلاح:
```bash
git checkout backup/known-good-2026-11-21 -- index.html app.js style.css manifest.json pwa-sw.js sw.js icons/
git status
git diff --stat
git commit -m "Restore frontend from known-good baseline"
```

لا تنس أن هذا يعيد ملفات المستودع فقط. لا يعيد إعدادات Cloudflare أو أسرارها أو حالة الخدمات الخلفية.

## 5. إعادة نشر النسخة المرجعية

بعد استعادة ملفات Git:
1. تحقق من الملفات التي ستُنشر.
2. انشر Worker الواجهة `jokstream-site` من bundle الصحيح.
3. حافظ على metadata وbindings الموجودة.
4. لا تنشر Worker `jokstream-api`.
5. أعد قراءة bundle المنشور وتأكد من تطابق `/app.js`, `/index.html`, `/style.css`.
6. اختبر الموقع مع cache refresh فريد.
7. نفذ قائمة الاختبار في OPERATIONS-AR.md.

**مهم:** إعادة commit في GitHub لا تعني تلقائياً أن Worker المضمّن قد عاد للنسخة السابقة. يجب نشر Worker الواجهة والتحقق منه.

## 6. ما الذي لا يشمله backup؟
فرع Git يحفظ ملفات المستودع فقط. لا يحفظ:
- Cloudflare secrets مثل TMDB_TOKEN أو TMDB_API_KEY.
- D1 databases أو KV أو محتوياتها.
- إعدادات Worker bindings أو routes أو domains.
- حسابات المزودين أو مفاتيحهم.
- إعدادات Cloudflare خارج ملفات Git.
- cache المتصفح أو بيانات My List على جهاز المستخدم.

لا توجد في هذا المستودع نسخة احتياطية من jokstream-api أو jokflix. لا تحاول إعادة بنائهما من وثائق الواجهة.

## 7. إجراء الطوارئ المختصر

1. أوقف التعديلات الجديدة.
2. سجل وقت ظهور المشكلة وآخر commit/نشر.
3. افحص هل الخدمة المتأثرة هي الموقع أم jokflix أم jokstream-api أم VidSrc.
4. قارن آخر تغيير بالنسخة المرجعية.
5. استعد أصغر عدد ممكن من الملفات.
6. انشر Worker الواجهة فقط إذا كانت المشكلة في الواجهة.
7. اختبر جميع الوظائف الحساسة.
8. أضف سبب المشكلة والحل إلى سجل التغييرات.

## 8. بعد أي إصلاح ناجح
أنشئ backup branch جديداً باسم مثل:
`backup/known-good-YYYY-MM-DD`
من commit الذي تم اختباره فعلياً. لا تحدّث الفرع القديم؛ احتفظ بالنسخ التاريخية.
