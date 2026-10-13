/**
 * Yardım başvurusu aşama kayıt defteri — çekim (portal flow + 'Aşama' sütunu
 * eşlemesi), rapor ekranları ve Excel export bu tek listeden beslenir.
 * Yeni aşama eklemek için buraya satır ekleyip flow id'sini
 * relief.DEFAULT_FLOW'a eklemek yeterlidir; eski snapshot'lardaki bilinmeyen
 * aşamalar görmezden gelinir, eksik aşamalar 0 sayılır.
 */
export interface YardimStage {
  key: string; // DB stage_key değeri
  flowId: number; // portal flow id'si
  label: string; // portal exportundaki 'Aşama' sütunu metni (tam eşleşme)
  kisa: string; // UI kısa adı (kart/rozet/efsane)
  color: string; // grafik rengi (tema paleti)
  kritik: boolean; // kritik eşik hesabına girer mi (sahanın aksiyon alanı)
  bekleyen: boolean; // 'bekleyen' toplamına girer mi (ödeme başlayan dosya beklemez)
}

export const YARDIM_STAGES: YardimStage[] = [
  { key: "si", flowId: 23, label: "Sosyal İnceleme", kisa: "Sosyal İnc.", color: "#00764b", kritik: true, bekleyen: true },
  { key: "bk", flowId: 179, label: "Bölge Koordinatörü Kararı", kisa: "Koordinatör", color: "#b99961", kritik: true, bekleyen: true },
  { key: "kk", flowId: 25, label: "Komisyon Karar Aşaması", kisa: "Komisyon", color: "#2f9e77", kritik: false, bekleyen: true },
  { key: "od", flowId: 188, label: "Ödeme Süreci", kisa: "Ödeme", color: "#d4b98a", kritik: false, bekleyen: false },
];

export const STAGE_KEYS = YARDIM_STAGES.map((s) => s.key);

/** Kritik eşik hesabına giren aşamalar (komisyon/ödeme süreçteki dosyalardır,
 * sahanın aksiyonu beklenmez — kritik sayılmaz). */
export const KRITIK_STAGE_KEYS = YARDIM_STAGES.filter((s) => s.kritik).map((s) => s.key);

/** 'Bekleyen' toplamına giren aşamalar: Sİ+BK+Komisyon. Ödeme Süreci dosyanın
 * ödemesi başladığı için bekleyen sayılmaz; yalnız kendi sütununda görünür. */
export const BEKLEYEN_STAGE_KEYS = YARDIM_STAGES.filter((s) => s.bekleyen).map(
  (s) => s.key,
);

export const stageByKey = new Map(YARDIM_STAGES.map((s) => [s.key, s]));
