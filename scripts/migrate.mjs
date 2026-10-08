// Boot'ta çalışan programatik migration (Dockerfile CMD: node scripts/migrate.mjs && node server.js)
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

// 2026-10 plan hedefleri (bagis-demo/plans.json'dan ilk seed; sonrası admin panelden)
const SEED_PLANS_MONTH = "2026-10";
const SEED_PLANS = {
  "1.BÖLGE": 200000, "2.BÖLGE": 45000, "3.BÖLGE": 42500, "4.BÖLGE": 17000,
  "5.BÖLGE": 48000, "6.BÖLGE": 85000, "7.BÖLGE": 82500, "8.BÖLGE": 30000,
  "9.BÖLGE": 60700, "10.BÖLGE": 19250, "11.BÖLGE": 101000, "12.BÖLGE": 100000,
  "13.BÖLGE": 13500, "14.BÖLGE": 117000, "15.BÖLGE": 21000, "16.BÖLGE": 27000,
  "17.BÖLGE": 105000, "18.BÖLGE": 9000, "19.BÖLGE": 100000, "20.BÖLGE": 133000,
};

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("migrations: ok");
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM plans");
  if (rows[0].n === 0) {
    for (const [bolge, amount] of Object.entries(SEED_PLANS)) {
      await pool.query(
        "INSERT INTO plans (month, bolge_label, amount) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [SEED_PLANS_MONTH, bolge, amount],
      );
    }
    console.log("plans seed: ok (" + SEED_PLANS_MONTH + ")");
  }
} catch (err) {
  console.error("migrations: FAILED", err);
  process.exit(1);
} finally {
  await pool.end();
}
