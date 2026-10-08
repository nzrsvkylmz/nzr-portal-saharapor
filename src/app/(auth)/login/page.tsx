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
  const [busy, setBusy] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nick, pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Giriş başarısız.");
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
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="NEZİR"
            width={88}
            height={76}
            className="mx-auto mb-3"
          />
          <div className="font-heading text-3xl font-bold tracking-wide text-primary">
            NEZİR
          </div>
          <p className="mt-1 text-sm text-ink/70">Saha Rapor Portalı</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm">
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
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
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
                className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
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

        <p className="mt-6 text-center text-xs text-ink/50">
          Hayra Adanmış Gönüller
        </p>
      </div>
    </main>
  );
}
