import "dotenv/config";
import { Pool } from "pg";
import { BigQuery } from "@google-cloud/bigquery";

// Load env vars
const {
  DATABASE_URL,
  BIGQUERY_PROJECT_ID,
  BIGQUERY_DATASET,
  BIGQUERY_TABLE_PROFILES,
} = process.env;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
if (!BIGQUERY_PROJECT_ID) {
  throw new Error("BIGQUERY_PROJECT_ID is not set");
}
if (!BIGQUERY_DATASET) {
  throw new Error("BIGQUERY_DATASET is not set");
}
if (!BIGQUERY_TABLE_PROFILES) {
  throw new Error("BIGQUERY_TABLE_PROFILES is not set");
}

// Postgres pool
const pgPool = new Pool({
  connectionString: DATABASE_URL,
});

// BigQuery client
const bigquery = new BigQuery({
  projectId: BIGQUERY_PROJECT_ID,
});

async function ensureTableExists() {
  const dataset = bigquery.dataset(BIGQUERY_DATASET as string);

  // Create dataset if it doesn't exist yet
  await dataset.get({ autoCreate: true });

  const table = dataset.table(BIGQUERY_TABLE_PROFILES as string);

  const schema = {
    fields: [
      { name: "id", type: "STRING" },
      { name: "email", type: "STRING" },
      { name: "user_id", type: "STRING" },
      { name: "anonymous_id", type: "STRING" },
      { name: "total_orders", type: "INT64" },
      { name: "total_spend", type: "NUMERIC" },
      { name: "last_seen_at", type: "TIMESTAMP" },
    ],
  };

  await table.get({ autoCreate: true, schema });

  return table;
}

async function fetchProfilesFromPostgres() {
  const client = await pgPool.connect();
  try {
    const res = await client.query(
      `
      SELECT
        id,
        email,
        user_id,
        anonymous_id,
        total_orders,
        total_spend,
        last_seen_at
      FROM profiles
      ORDER BY last_seen_at DESC;
      `
    );
    return res.rows;
  } finally {
    client.release();
  }
}

async function exportProfilesToBigQuery() {
  console.log("Starting export: Postgres -> BigQuery (profiles)");

  const table = await ensureTableExists();

  const profiles = await fetchProfilesFromPostgres();
  console.log(`Fetched ${profiles.length} profiles from Postgres`);

  if (profiles.length === 0) {
    console.log("No profiles to export. Done.");
    return;
  }

  // Map Postgres rows to BigQuery rows
  const rows = profiles.map((p) => ({
    id: String(p.id),
    email: p.email || null,
    user_id: p.user_id || null,
    anonymous_id: p.anonymous_id || null,
    total_orders: Number(p.total_orders || 0),
    total_spend: p.total_spend !== null ? Number(p.total_spend) : 0,
    last_seen_at: p.last_seen_at ? new Date(p.last_seen_at) : null,
  }));

  // For demo purposes, we'll just overwrite by truncating table first.
  // In a real system, you'd use partitioning or upserts.
  console.log("Clearing existing BigQuery table rows...");
  const deleteQuery = `DELETE FROM \`${BIGQUERY_PROJECT_ID}.${BIGQUERY_DATASET}.${BIGQUERY_TABLE_PROFILES}\` WHERE TRUE`;
  await bigquery.query(deleteQuery).catch((err: any) => {
    // Query may fail if table is empty or doesn't exist; ignore that
    if (err && err.code !== 404) {
      console.warn("Delete query warning:", err.message || err);
    }
  });

  console.log("Inserting rows into BigQuery...");
  await table.insert(rows);

  console.log("Export complete!");
}

exportProfilesToBigQuery()
  .catch((err) => {
    console.error("Export failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgPool.end();
  });
  