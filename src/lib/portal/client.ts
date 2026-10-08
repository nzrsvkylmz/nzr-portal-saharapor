/**
 * Nezir Sistem Plus salt-okunur bağlantı istemcisi.
 * yardim-demo/nezir_client.py'nin TypeScript portu — davranış birebir korunur.
 *
 * Güvenlik kuralı: uzak sisteme yalnızca POST /login ve POST /verify gönderilir.
 * Veri istekleri GET'tir ve YALNIZCA izin listesindeki modül sayfalarına atılabilir.
 */
import { CookieJar } from "tough-cookie";
import { LoginRequired, RemoteError, VerifyRequired } from "./errors";

export const BASE_URL = process.env.PORTAL_BASE_URL ?? "https://nezir.sistem.plus";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

export type PortalState = "authenticated" | "verify" | "login" | "unknown";

interface RequestOptions {
  data?: Record<string, string>;
  ajax?: boolean;
  referer?: string;
  follow?: boolean;
  timeoutMs?: number;
}

interface PortalResponse {
  status: number;
  headers: Headers;
  text: string;
}

function stripBom(s: string): string {
  return s.replace(/^﻿/, "");
}

export class NezirClient {
  // Oturum yoklaması: sorgu çalıştırmayan hafif filtre paneli.
  static PROBE_PATH = "/crea/relief/application/filter/index";

  // Veri istekleri YALNIZCA bu modül sayfalarına atılabilir.
  static ALLOWED_READ_PATHS = [
    "/crea/relief/needy", // ihtiyaç sahipleri listesi + filter/export
    "/crea/relief/application", // yardım başvuruları listesi + filter/export
    "/crea/donate/donate", // bağış listesi + filter/export
    "/crea/definate/admin/admin", // kullanıcı hesapları listesi + detay (kullanıcı senkronu)
  ];

  readonly jar: CookieJar;
  private readonly baseUrl: string;

  constructor(jar?: CookieJar, baseUrl: string = BASE_URL) {
    this.jar = jar ?? new CookieJar();
    this.baseUrl = baseUrl;
  }

  clearSession(): void {
    this.jar.removeAllCookiesSync();
  }

  // ---- HTTP yardımcıları ----

  private async rawFetch(
    method: string,
    url: string,
    opts: RequestOptions,
  ): Promise<PortalResponse> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.7",
      "Cache-Control": "no-cache",
    };
    if (opts.ajax) {
      headers["Accept"] = "application/json, text/javascript, */*; q=0.01";
      headers["X-Requested-With"] = "XMLHttpRequest";
      headers["Origin"] = this.baseUrl;
    } else {
      headers["Accept"] =
        "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8";
    }
    if (opts.referer) headers["Referer"] = this.baseUrl + opts.referer;

    const cookie = await this.jar.getCookieString(url);
    if (cookie) headers["Cookie"] = cookie;

    let body: string | undefined;
    if (opts.data) {
      body = new URLSearchParams(opts.data).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const resp = await fetch(url, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });

    for (const sc of resp.headers.getSetCookie()) {
      try {
        await this.jar.setCookie(sc, url);
      } catch {
        // geçersiz tek bir cookie tüm isteği düşürmesin
      }
    }

    return { status: resp.status, headers: resp.headers, text: await resp.text() };
  }

  async request(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<PortalResponse> {
    if (!path.startsWith("/")) throw new RemoteError("Geçersiz uzak sistem yolu.");

    let resp: PortalResponse;
    try {
      resp = await this.rawFetch(method, this.baseUrl + path, opts);
      // follow=true: cookie'leri her atlamada işleyerek yönlendirmeleri elle izle
      let hops = 0;
      while (opts.follow && resp.status >= 300 && resp.status < 400 && hops < 5) {
        const loc = resp.headers.get("location");
        if (!loc) break;
        const nextUrl = new URL(loc, this.baseUrl).toString();
        resp = await this.rawFetch("GET", nextUrl, { timeoutMs: opts.timeoutMs });
        hops += 1;
      }
    } catch (err) {
      if (err instanceof RemoteError) throw err;
      throw new RemoteError(
        "Nezir Sistem'e ulaşılamadı: " + (err instanceof Error ? err.message : String(err)),
      );
    }
    return resp;
  }

  // ---- login / OTP akışı ----

  /** 'authenticated' | 'verify' döndürür; hata durumunda RemoteError fırlatır. */
  async login(nick: string, password: string): Promise<"authenticated" | "verify"> {
    if (!nick || !password) throw new RemoteError("Kullanıcı adı ve şifre gerekli.");
    this.clearSession();

    let r = await this.request("GET", "/login");
    if (!(r.status >= 200 && r.status < 400)) {
      this.clearSession();
      throw new RemoteError(`Giriş sayfası açılamadı. HTTP ${r.status}`);
    }

    // {"action":"redirectlocation","data":"/verify"} → OTP gerekli
    // {"action":"redirect","data":"/crea"}           → tanımlı IP, OTP atlandı
    r = await this.request("POST", "/login", {
      data: { nick, pass: password, go: "Giriş yap" },
      ajax: true,
      referer: "/login",
    });
    if (!(r.status >= 200 && r.status < 300)) {
      this.clearSession();
      throw new RemoteError(`Login isteği başarısız. HTTP ${r.status}`);
    }

    const body = stripBom(r.text).trim();
    let redirect = "";
    let data: unknown = null;
    try {
      data = JSON.parse(body);
    } catch {
      data = null;
    }
    if (data && typeof data === "object") {
      const d = data as { action?: string; data?: unknown };
      if (d.action === "redirectlocation" || d.action === "redirect") {
        redirect = String(d.data ?? "");
      } else if (d.action === "alert") {
        // Sunucunun kendi hata mesajı (ör. "Kullanıcı adı veya şifre hatalı")
        this.clearSession();
        throw new RemoteError("Nezir Sistem: " + String(d.data ?? "Giriş reddedildi."));
      }
    }
    if (!redirect) {
      this.clearSession();
      throw new RemoteError("Login cevabı beklenen biçimde değil: " + body.slice(0, 200));
    }

    r = await this.request("GET", redirect, { follow: true });
    if (!(r.status >= 200 && r.status < 400)) {
      this.clearSession();
      throw new RemoteError(`Yönlendirme sayfası açılamadı. HTTP ${r.status}`);
    }

    if (!redirect.toLowerCase().includes("/verify")) {
      const state = await this.detectState();
      if (state === "authenticated") return "authenticated";
      if (state !== "verify") {
        this.clearSession();
        throw new RemoteError(
          "Giriş kabul edildi ancak oturum doğrulanamadı. Durum: " + state,
        );
      }
      return "verify";
    }

    const low = r.text.toLowerCase();
    if (
      !low.includes("verify") &&
      !low.includes("doğrulama") &&
      !low.includes("dogrulama") &&
      !low.includes('name="pass"')
    ) {
      if ((await this.detectState()) === "authenticated") return "authenticated";
    }
    return "verify";
  }

  async verify(otp: string): Promise<"authenticated"> {
    const code = (otp ?? "").trim();
    if (!code) throw new RemoteError("Doğrulama kodu gerekli.");
    const r = await this.request("POST", "/verify", {
      data: { pass: code, go: "" },
      ajax: true,
      referer: "/verify",
    });
    if (!(r.status >= 200 && r.status < 300)) {
      throw new RemoteError(`Doğrulama isteği başarısız. HTTP ${r.status}`);
    }
    const body = stripBom(r.text).trim();
    let data: { action?: string; data?: unknown } | null = null;
    try {
      data = JSON.parse(body);
    } catch {
      data = null;
    }
    if (data?.action === "alert") {
      throw new RemoteError("Nezir Sistem: " + String(data.data ?? "Doğrulama reddedildi."));
    }
    if (data?.action === "redirectlocation" && data.data) {
      const target = String(data.data);
      if (target.toLowerCase().includes("/verify")) {
        throw new RemoteError("Doğrulama kodu kabul edilmedi.");
      }
      await this.request("GET", target);
    }
    if ((await this.detectState()) !== "authenticated") {
      throw new RemoteError(
        "Kod gönderildi ancak oturum doğrulanamadı. Sunucu cevabı: " + body.slice(0, 160),
      );
    }
    return "authenticated";
  }

  async detectState(): Promise<PortalState> {
    let r: PortalResponse;
    try {
      r = await this.request("GET", NezirClient.PROBE_PATH);
    } catch {
      return "unknown";
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = (r.headers.get("location") ?? "").toLowerCase();
      if (loc.includes("/verify")) return "verify";
      if (loc.includes("/login")) return "login";
    }
    if (r.status === 200) {
      const low = r.text.toLowerCase();
      if (low.includes('name="nick"') && low.includes('name="pass"')) return "login";
      if (low.includes("/verify") && low.includes('name="pass"')) return "verify";
      return "authenticated";
    }
    return "unknown";
  }

  // ---- salt-okunur veri çekme ----

  /** Yalnızca izin listesindeki sayfalara GET. Gövde metnini döndürür. */
  async getReadonly(path: string, timeoutMs = 30_000): Promise<string> {
    if (!NezirClient.ALLOWED_READ_PATHS.some((p) => path.startsWith(p))) {
      throw new RemoteError(
        "İzin verilmeyen uzak sistem yolu: " +
          path.split("?")[0] +
          " — yalnızca yardım ve bağış modülü listeleri kullanılabilir.",
      );
    }
    const r = await this.request("GET", path, { timeoutMs });
    if (r.status >= 300 && r.status < 400) {
      const loc = (r.headers.get("location") ?? "").toLowerCase();
      if (loc.includes("/verify")) throw new VerifyRequired();
      if (loc.includes("/login")) throw new LoginRequired();
    }
    const low = r.status === 200 ? r.text.toLowerCase() : "";
    const loginLike =
      low.includes('name="nick"') && low.includes('name="pass"');
    const verifyLike = low.includes("/verify") && low.includes('name="pass"');
    if (r.status === 200 && (loginLike || verifyLike)) {
      // Kullanıcı düzenleme formları da nick/pass alanı içerir (yanlış pozitif).
      // Gerçek durumu hafif yoklamayla doğrula; oturum sağlamsa sayfa geçerlidir.
      const state = await this.detectState();
      if (state === "login") throw new LoginRequired();
      if (state === "verify") throw new VerifyRequired();
    }
    if (!(r.status >= 200 && r.status < 300)) {
      throw new RemoteError(`Nezir Sistem veri isteği başarısız. HTTP ${r.status}`);
    }
    return r.text;
  }
}
