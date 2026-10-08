# Railway Canlıya Alma

Uygulama Dockerfile ile paketlenir; konteyner açılışta migration'ları çalıştırıp
(`node scripts/migrate.mjs`) sunucuyu başlatır. Tek replika varsayımı vardır
(rapor işleri aynı proseste koşar) — replika sayısını 1'de tutun.

## 1. Proje ve Postgres

1. [railway.app](https://railway.app) → **New Project**.
2. Veritabanı zaten Railway'de ise bu adımı atlayın; değilse **+ New → Database
   → PostgreSQL** ekleyin. (Mevcut geliştirme veritabanı kullanılacaksa uygulama
   servisini AYNI projeye kurun ki dahili ağdan erişsin.)

## 2. Uygulama servisi

1. Aynı projede **+ New → GitHub Repo** → `nzrsvkylmz/nzr-portal-saharapor`
   seçin (ilk kez ise GitHub erişimi için yetki verin).
2. Servis ayarlarında **Settings → Source → Branch**: `development`.
3. Builder otomatik **Dockerfile** olarak algılanır; değilse Settings → Build →
   Builder: Dockerfile seçin.

## 3. Ortam değişkenleri (service → Variables)

| Değişken | Değer |
|---|---|
| `DATABASE_URL` | Postgres aynı projedeyse referans verin: `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | `openssl rand -base64 32` çıktısı |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` çıktısı — **aşağıdaki nota bakın** |
| `PORTAL_BASE_URL` | `https://nezir.sistem.plus` |
| `INITIAL_ADMIN_NICK` | süper admin'in portal kullanıcı adı |

> **Not — mevcut veritabanıyla devam ediliyorsa:** `SESSION_SECRET` ve
> `ENCRYPTION_KEY` için lokaldeki `.env` değerlerinin AYNISINI kullanın; aksi
> halde kayıtlı portal oturumları (şifreli cookie'ler) çözülemez ve tüm
> kullanıcıların bir kez yeniden giriş yapması gerekir (veri kaybı olmaz,
> yalnız oturum tazelenir).

## 4. Yayınlama

1. Variables kaydedilince Railway otomatik deploy başlatır; **Deployments**
   sekmesinden logları izleyin. Başarılı açılışta logda `migrations: ok`
   satırını görmelisiniz.
2. **Settings → Networking → Generate Domain** ile `*.up.railway.app` adresi
   alın (veya kendi alan adınızı bağlayın).
3. Sağlık kontrolü (isteğe bağlı): Settings → Health Check path `/api/health`.

## 5. Açılış sonrası kontrol listesi

- [ ] `https://<domain>/login` açılıyor, logo görünüyor.
- [ ] `INITIAL_ADMIN_NICK` sahibi portal kimliğiyle girip SUPER_ADMIN olduğunu
      doğruladı (giriş portal oturum çerezlerini de tazeler).
- [ ] `/admin/raporlar` → yardım ve bağış raporu birer kez güncellendi.
- [ ] Bir temsilci ve bir bölge müdürü hesabıyla kapsamlar test edildi.

## Güncelleme akışı

`development` dalına her push otomatik deploy tetikler. Üretimi ayrı dala
bağlamak isterseniz: `main` dalı açın, servis branch'ini `main` yapın ve
yayınlamak istediğinizde `development` → `main` merge edin.
