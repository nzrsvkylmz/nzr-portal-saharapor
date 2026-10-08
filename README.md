# NEZİR Saha Rapor Portalı

Bağış ve yardım raporlarını NEZİR Sistem Plus portalından çekip bölge/temsilcilik
bazlı, rol kapsamlı olarak sunan web uygulaması.

- **Stack:** Next.js 15 (App Router, TypeScript) · Tailwind CSS v4 · Drizzle ORM · PostgreSQL
- **Deploy:** GitHub → Railway (tek servis + Railway Postgres)
- **Kimlik:** Kullanıcılar Sistem Plus kullanıcı adı/şifresiyle giriş yapar (OTP dahil);
  ayrı şifre tutulmaz. Rol/birim yetkisi admin panelden atanır.

## Roller

| Rol | Yetki |
|---|---|
| `SUPER_ADMIN` | Her şey + kullanıcı yetkilendirme |
| `ADMIN_BAGIS` (Muhasebe) | Bağış raporunu günceller, aylık planları düzenler |
| `ADMIN_YARDIM` (Sosyal Yardımlar) | Yardım raporunu günceller |
| `BOLGE_MUDURU` | Kendi bölgesindeki tüm birimlerin verisini görür |
| `TEMSILCI` | Atandığı birim(ler) + aynı şehirdeki ilçe birimlerini görür |

Saha salt-okunurdur; veri yalnız adminlerin tetiklediği güncellemelerle (snapshot)
yenilenir. **Kişisel veri asla saklanmaz** — DB'ye yalnız birim bazlı toplamlar yazılır.

## Lokal geliştirme

```bash
npm install
copy .env.example .env    # değerleri doldur
npm run db:generate       # şema değiştiyse migration üret
npm run migrate           # DATABASE_URL'e uygular (+ ilk plan seed'i)
npm run dev
```

- Test: `npm test`
- Portal duman testi (gerçek kimlikle, salt-okunur): `npm run smoke:portal`

## Ortam değişkenleri

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | Postgres bağlantısı (Railway: Postgres servisinden referans) |
| `SESSION_SECRET` | Oturum imzalama anahtarı (`openssl rand -base64 32`) |
| `ENCRYPTION_KEY` | Portal cookie şifreleme — 32 byte base64 (`openssl rand -base64 32`) |
| `PORTAL_BASE_URL` | Varsayılan `https://nezir.sistem.plus` |
| `INITIAL_ADMIN_NICK` | İlk girişinde SUPER_ADMIN atanacak portal kullanıcı adı |
| `CRON_TOKEN` | (İleriki faz) GitHub Actions cron tetiklemesi için |

## Railway deploy

1. Bu klasörü GitHub reposuna push et.
2. Railway'de **New Project → Deploy from GitHub repo** (Dockerfile otomatik algılanır).
3. **+ New → Database → PostgreSQL** ekle; uygulama servisinde `DATABASE_URL` değişkenine
   Postgres servisinin referansını ver (`${{Postgres.DATABASE_URL}}`).
4. Diğer env değişkenlerini gir (üstteki tablo).
5. Healthcheck path: `/api/health`.
6. İlk deploy sonrası `INITIAL_ADMIN_NICK`'te tanımlı kullanıcıyla giriş yap →
   Yönetim → Raporlar'dan yardım raporunu bir kez güncelle (birimler senkronlanır) →
   Kullanıcılar ekranından ekibe rol/birim ata.

> ⚠️ **Tek replika çalıştırın.** Rapor güncelleme işleri uygulama prosesi içinde
> yürür ve tek-iş kilidi bu varsayıma dayanır.

## Mimari notlar

- `src/lib/portal/` — Sistem Plus istemcisi (login/OTP/cookie jar) ve
  SpreadsheetML/HTML parser'ları. Uzak sisteme yalnız `POST /login`, `POST /verify`
  ve beyaz listedeki `GET` yolları gider.
- `src/lib/jobs/` — rapor işleri: route tetikler, iş aynı proseste async yürür,
  UI `/api/jobs/:id` üzerinden izler. Snapshot'lar `report_runs` + aggregate
  tablolarına atomik yazılır.
- `src/lib/domain/scope.ts` — rol → görünür birim kümesi; tüm rapor sorguları
  sunucu tarafında bu kapsamla süzülür.
- Portal cookie'leri kullanıcı başına AES-256-GCM ile şifrelenip `portal_sessions`
  tablosunda tutulur; rapor çekimi, tetikleyen adminin kendi portal oturumuyla yapılır.

## Sonraki fazlar

- GitHub Actions ile gece otomatik güncelleme: `POST /api/reports/{kind}/trigger`
  route'una `Authorization: Bearer $CRON_TOKEN` desteği + servis hesabı.
- Yardım raporuna ek aşamalar (ör. Ödeme Süreci) — `app_settings.yardim.flows`
  üzerinden flow id'leri eklenerek genişletilebilir.
