import { NextResponse } from "next/server";

// Geçici teşhis ucu: Sistem Plus'ın gördüğü çıkış IP'sini doğrulamak için.
// Sabit IP sorunu çözülünce silinecek.
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
