"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = "credentials" | "otp";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [nick, setNick] = useState("");
  const [pass, setPass] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [portalHint, setPortalHint] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setPortalHint(false);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nick, pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Giriş başarısız.");
        // 401 = Sistem Plus girişi reddetti (yanlış şifre, zorunlu şifre
        // yenileme vb.) → kullanıcıyı önce portalda denemeye yönlendir.
        setPortalHint(res.status === 401);
      } else if (data.needsOtp) {
        setStep("otp");
      } else {
        router.replace(data.pending ? "/bekliyor" : "/");
        router.refresh();
      }
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Doğrulama başarısız.");
        if (data.restart) {
          setStep("credentials");
          setOtp("");
        }
      } else {
        router.replace(data.pending ? "/bekliyor" : "/");
        router.refresh();
      }
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-4"
      style={{
        background:
          "radial-gradient(1200px 600px at 85% -10%, rgba(200,237,217,0.25), transparent 60%), linear-gradient(140deg,#004d32 0%,#00764b 55%,#2f9e77 115%)",
      }}
    >
      {/* dekoratif ışık lekeleri */}
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-mint/20 blur-3xl" />
      <div className="pointer-events-none absolute right-1/4 top-10 h-40 w-40 rounded-full bg-gold/20 blur-2xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-white shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="NEZİR" width={56} height={48} />
          </span>
          <div className="font-heading text-3xl font-bold tracking-wide text-white">
            NEZİR
          </div>
          <p className="mt-1 text-sm text-white/75">Saha Rapor Portalı</p>
        </div>

        <div className="rounded-3xl bg-white/95 p-8 shadow-2xl backdrop-blur">
          {step === "credentials" ? (
            <form onSubmit={submitCredentials} className="space-y-4">
              <p className="text-sm text-ink/70">
                Sistem Plus kullanıcı adı ve şifrenizle giriş yapın.
              </p>
              <div>
                <label htmlFor="nick" className="mb-1 block text-sm font-medium">
                  Kullanıcı adı
                </label>
                <input
                  id="nick"
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  autoComplete="username"
                  required
                  className="w-full rounded-xl border border-mint bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label htmlFor="pass" className="mb-1 block text-sm font-medium">
                  Şifre
                </label>
                <input
                  id="pass"
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="w-full rounded-xl border border-mint bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              {error && <p className="text-sm text-red-700">{error}</p>}
              {portalHint && (
                <div className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-xs leading-relaxed text-ink/80">
                  Girişiniz Sistem Plus tarafından kabul edilmedi. Önce portalı
                  ayrı bir sekmede açıp giriş yapabildiğinizi doğrulayın; şifre
                  yenilemeniz isteniyorsa orada yenileyin, ardından buradan yeni
                  şifrenizle tekrar deneyin.{" "}
                  <a
                    href="https://nezir.sistem.plus/login"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-primary hover:underline"
                  >
                    Sistem Plus&apos;ı aç ↗
                  </a>
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#004d32,#00764b)" }}
              >
                {busy ? "Giriş yapılıyor…" : "Giriş yap"}
              </button>
            </form>
          ) : (
            <form onSubmit={submitOtp} className="space-y-4">
              <p className="text-sm text-ink/70">
                Telefonunuza gelen doğrulama kodunu (OTP) girin.
              </p>
              <div>
                <label htmlFor="otp" className="mb-1 block text-sm font-medium">
                  Doğrulama kodu
                </label>
                <input
                  id="otp"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  className="w-full rounded-xl border border-mint bg-white px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-primary"
                />
              </div>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#004d32,#00764b)" }}
              >
                {busy ? "Doğrulanıyor…" : "Doğrula"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("credentials");
                  setOtp("");
                  setError("");
                }}
                className="w-full text-center text-xs text-ink/60 hover:text-ink"
              >
                ← Baştan giriş yap
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-white/60">
          Hayra Adanmış Gönüller
        </p>
      </div>
    </main>
  );
}
