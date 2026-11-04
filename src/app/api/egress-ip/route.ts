import { NextResponse } from "next/server";

// Sistem Plus'ın gördüğü çıkış IP'sini gösterir; Railway sabit çıkış
// IP'lerinin devrede olduğunu kontrol etmek için.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await fetch("https://api.ipify.org?format=json", {
      cache: "no-store",
    });
    const { ip } = (await r.json()) as { ip: string };
    return NextResponse.json({ egressIp: ip });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
