# mini-cdp
A minimal “Customer Data Platform” (CDP) core designed for learning and experimentation.

It implements the basic CDP flow:
Collect → Unify → Segment → Activate

Collect: Ingest events and traits via HTTP APIs
Unify: Build customer profiles with simple identity resolution
Segment: Compute audiences from profile + event data


This mini project models the core pieces of a Customer Data Platform (CDP) + a simple real-time decision engine for personalization at the moment of engagement.

The core question is: given everything we know about a customer, and what they’re doing right now (e.g., viewing a product, checking out), what is the most relevant recommendation we can show with low latency?

In a real system, you can’t afford to recompute a customer’s lifetime value, visit frequency, or segment membership on every request. Instead, you maintain pre-aggregated profile data in the background and combine it with real-time events at decision time. This repo simulates that “hybrid” approach:

Background: events are used to maintain aggregated profile attributes (e.g., spend in the last 30 days, visit frequency).

Real-time: when a new event comes in (e.g., a checkout), we combine that event with the existing profile and audience memberships to choose the best experience.

The data model includes four tables:

profiles – one row per customer, storing core identifiers and precomputed aggregates (e.g., total_spent_last_30d, visit_count, VIP flags). This allows us to read the key attributes we care about in a single, low-latency lookup instead of recalculating them in real time.

events – an append-only log of customer interactions across channels (e.g., POS, web, OTT). This serves both as the source of truth for background aggregations and the representation of the “current” action.

audiences – reusable segment definitions such as “high-value VIP” or “frequent visitor.” These represent the strategies we want to apply across large groups of customers.

audience_members – a many-to-many mapping between profiles and audiences, since a single customer can belong to multiple segments.

The UI in this repo simulates a simple checkout flow. When you submit a user_id and checkout_amount, the system:

Ensures a profile exists for the user (and creates one if it doesn’t).

Writes a new event to the events table and updates the corresponding profile aggregates based on historical events.

Evaluates which audiences the customer belongs to, based on the latest profile attributes.

Applies a simple decision rule to choose what to show: for example, VIP customers might see a premium upgrade offer, while others see a lower-risk cross-sell.

This is not a full CDP implementation, but a minimal, self-contained demo that illustrates how I think about CDP data modeling and low-latency activation for commerce use cases.

What this does not include yet:
- identity resolution
- streaming pipeline
- multi-channel activation

In a production environment, these concepts would typically be split across multiple layers:

- A warehouse or lakehouse (e.g., Snowflake, or tables in Apache Iceberg/Delta Lake on object storage) would store raw and aggregated events for analytics and batch/micro-batch processing.
- Batch or streaming jobs would maintain profile aggregates and audience memberships and publish them into an online store (e.g., DynamoDB as a key-value / document store) optimized for low-latency reads.
- A real-time service (similar to the one in this demo) would:
  - Ingest the current event,
  - Fetch the latest profile and segment state from the online store, and
  - Call into a recommendation/decision engine to select the personalized offer.

This repo focuses on the core data model and decision logic, not the full production pipeline, but the same principles apply at scale.

**Goal**: Ingest events + traits, unify into profiles, build 1 - 2 simple audiences, and export/activate them

**Data Model**:

- profiles (id, email, user_id, first_seen_at, last_seen_at, total_orders, total_spend, traits JSONB)
- events (id, profile_id?, anonymous_id, user_id, event_type, properties JSONB, occurred_at)
- audiences (id, name, definition JSON, last_built_at)
- audience_members (audience_id, profile_id, added_at)

```mermaid
erDiagram
  PROFILES {
    int        id PK
    text       primary_identifier
    text       email
    text       user_id
    text       anonymous_id
    jsonb      traits
    int        total_orders
    numeric    total_spend
    timestamptz first_seen_at
    timestamptz last_seen_at
  }

  EVENTS {
    int        id PK
    int        profile_id FK
    text       user_id
    text       anonymous_id
    text       event_type
    jsonb      properties
    timestamptz occurred_at
  }

  AUDIENCES {
    int        id PK
    text       name
    jsonb      definition
    timestamptz created_at
    timestamptz last_built_at
  }

  AUDIENCE_MEMBERS {
    int        id PK
    int        audience_id FK
    int        profile_id FK
    timestamptz added_at
  }

  PROFILES ||--o{ EVENTS : "has many events"
  PROFILES ||--o{ AUDIENCE_MEMBERS : "is in many audiences"
  AUDIENCES ||--o{ AUDIENCE_MEMBERS : "has many members"

**Identity rules (simple, deterministic):**

- If user_id or email exists → attach/update that profile
- otherwise → create placeholder profile (or keep as anonymous)

---

## 1. Features

* `POST /identify` – Upsert customer profiles (email, user_id, traits)
* `POST /track` – Track events (page views, purchases, etc.)
* Basic identity resolution (merge on `email` / `user_id`)
* Audience definitions stored in DB
* Rebuild audiences with a SQL-based job
* `GET /audiences/:id/export` – Export audience members as CSV

---

## 2. Tech Stack

* **Backend**: Node.js, TypeScript, Express
* **Database**: PostgreSQL
* **ORM/Client**: `pg` (simple query client)
* **Env management**: `dotenv`
* **Container**: Docker (for Postgres)

---

## 3. Prerequisites

You’ll need:

* Node.js **v18+** (v20+ recommended)
* Docker + Docker Compose
* `git`
* Optional: `psql` CLI client

---

## 4. Getting Started

### 4.1. Clone and install

```bash
# Clone this repository
git clone <YOUR_REPO_URL> mini-cdp
cd mini-cdp

# Initialize a Node project if you haven’t already
npm init -y

# Install dependencies
npm install express pg dotenv cors
npm install --save-dev typescript ts-node-dev @types/node @types/express
```

Initialize TypeScript:

```bash
npx tsc --init
```

In your `package.json`, add scripts:

```jsonc
"scripts": {
  "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js"
}
```

Create a basic folder structure:

```bash
mkdir -p src
touch src/index.ts
```

You’ll wire up the actual code later to match the endpoints described below.

---

### 4.2. Start PostgreSQL with Docker

Create a `docker-compose.yml` in the project root:

```yaml
version: "3.8"

services:
  db:
    image: postgres:16
    restart: always
    environment:
      POSTGRES_USER: cdp
      POSTGRES_PASSWORD: cdp
      POSTGRES_DB: cdp
    ports:
      - "5432:5432"
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
```

Start Postgres:

```bash
docker compose up -d db
```

Check it’s running:

```bash
docker compose ps
```

---

### 4.3. Configure environment variables

Create a `.env` file in the project root:

```bash
cp .env.example .env  # if you have an example
# OR create directly:
```

`.env`:

```env
PORT=3000
DATABASE_URL=postgres://cdp:cdp@localhost:5432/cdp
```

Your Node app should read `DATABASE_URL` via `process.env.DATABASE_URL`.

---

### 4.4. Create the database schema

Connect to Postgres (inside the running container or from host):

```bash
# Using docker and psql
docker exec -it $(docker ps -qf "name=mini-cdp-db-1") psql -U cdp -d cdp

# or, if you have psql locally and Postgres is listening on localhost:
psql -h localhost -U cdp -d cdp
# password: cdp
```

Run the following SQL to set up the schema.

#### 4.4.1. Enable UUID extension

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

#### 4.4.2. Profiles table

```sql
CREATE TABLE profiles (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  primary_identifier text,
  email             text UNIQUE,
  user_id           text UNIQUE,
  anonymous_id      text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  total_orders      integer NOT NULL DEFAULT 0,
  total_spend       numeric(12,2) NOT NULL DEFAULT 0,
  traits            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_profiles_email ON profiles (email);
CREATE INDEX idx_profiles_user_id ON profiles (user_id);
CREATE INDEX idx_profiles_anonymous_id ON profiles (anonymous_id);
```

#### 4.4.3. Events table

```sql
CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id   uuid REFERENCES profiles(id),
  anonymous_id text,
  user_id      text,
  event_type   text NOT NULL,
  properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_profile_id ON events (profile_id);
CREATE INDEX idx_events_anonymous_id ON events (anonymous_id);
CREATE INDEX idx_events_user_id ON events (user_id);
CREATE INDEX idx_events_occurred_at ON events (occurred_at);
```

#### 4.4.4. Audiences and audience_members

```sql
CREATE TABLE audiences (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  definition   jsonb NOT NULL, -- rules for building the audience
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_built_at timestamptz
);

CREATE TABLE audience_members (
  audience_id  integer REFERENCES audiences(id) ON DELETE CASCADE,
  profile_id   uuid REFERENCES profiles(id) ON DELETE CASCADE,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audience_id, profile_id)
);
```

---

## 5. API Design

The README assumes you’ll implement the following endpoints in `src/index.ts`.

### 5.1. `POST /identify`

Upsert a profile with traits.

**Request body (example):**

```json
{
  "email": "alice@example.com",
  "user_id": "user_123",
  "anonymous_id": "anon_abc",
  "traits": {
    "name": "Alice",
    "plan": "gold"
  }
}
```

**Behavior (expected):**

* If `user_id` or `email` exists → update that profile:

  * Set `primary_identifier` if empty
  * Update `traits` (merge or replace)
  * Update `last_seen_at`
* Otherwise → create a new profile.

**Example cURL:**

```bash
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "user_id": "user_123",
    "anonymous_id": "anon_abc",
    "traits": { "name": "Alice", "plan": "gold" }
  }'
```

---

### 5.2. `POST /track`

Track an event for a user.

**Request body (example):**

```json
{
  "event_type": "purchase",
  "user_id": "user_123",
  "anonymous_id": "anon_abc",
  "properties": {
    "order_id": "ord_001",
    "amount": 59.99,
    "currency": "USD"
  },
  "occurred_at": "2025-11-22T15:00:00Z"
}
```

**Behavior (expected):**

* Try to attach the event to an existing profile using:

  * `user_id` → `profiles.user_id`, or
  * `email` if provided, or
  * `anonymous_id` if nothing else exists.
* If no matching profile and at least `user_id` or `email` is present, create a new profile.
* Increment `total_orders` and `total_spend` on the profile for purchase-like events.
* Update `last_seen_at`.

**Example cURL:**

```bash
curl -X POST http://localhost:3000/track \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "purchase",
    "user_id": "user_123",
    "anonymous_id": "anon_abc",
    "properties": { "order_id": "ord_001", "amount": 59.99, "currency": "USD" },
    "occurred_at": "2025-11-22T15:00:00Z"
  }'
```

---

### 5.3. `POST /audiences`

Create an audience definition.

You can define audiences however you like. A simple JSON rule model is enough.

**Request body (example):**

```json
{
  "name": "High value last 30 days",
  "definition": {
    "min_total_spend": 100,
    "days_since_last_event": 30
  }
}
```

**Expected behavior:**

* Insert into `audiences(name, definition)`.

**Example cURL:**

```bash
curl -X POST http://localhost:3000/audiences \
  -H "Content-Type: application/json" \
  -d '{
    "name": "High value last 30 days",
    "definition": { "min_total_spend": 100, "days_since_last_event": 30 }
  }'
```

You’ll map `definition` to actual SQL in a rebuild job (see below).

---

### 5.4. Audience rebuild job (SQL example)

You can implement rebuilding in code (preferred), but here’s a SQL pattern to start with.

**Example rule:**
“Users whose `total_spend` > `min_total_spend` and last event within `days_since_last_event` days.”

Suppose we have an audience row:

```sql
INSERT INTO audiences (name, definition)
VALUES (
  'High value last 30 days',
  '{"min_total_spend": 100, "days_since_last_event": 30}'::jsonb
)
RETURNING id;
```

Say the `id` is `1`.

To rebuild:

```sql
WITH params AS (
  SELECT
    (definition->>'min_total_spend')::numeric AS min_total_spend,
    (definition->>'days_since_last_event')::int AS days_since_last_event
  FROM audiences
  WHERE id = 1
),
candidate_profiles AS (
  SELECT p.*
  FROM profiles p, params
  WHERE p.total_spend >= params.min_total_spend
),
recent_activity AS (
  SELECT e.profile_id, max(e.occurred_at) AS last_event_at
  FROM events e
  GROUP BY e.profile_id
)
DELETE FROM audience_members WHERE audience_id = 1;

INSERT INTO audience_members (audience_id, profile_id, added_at)
SELECT
  1 AS audience_id,
  cp.id AS profile_id,
  now() AS added_at
FROM candidate_profiles cp
JOIN recent_activity ra ON cp.id = ra.profile_id
JOIN params ON TRUE
WHERE ra.last_event_at >= (now() - (params.days_since_last_event || ' days')::interval);

UPDATE audiences
SET last_built_at = now()
WHERE id = 1;
```

You can wrap this in a Node endpoint like:

* `POST /audiences/:id/rebuild`

which runs equivalent logic using parameterized queries.

---

### 5.5. `GET /audiences/:id/export`

Export audience members as CSV.

**Expected behavior:**

* Join `audience_members` with `profiles`
* Stream as CSV (e.g., `email,total_spend,last_seen_at,...`)

**Example cURL:**

```bash
curl -X GET http://localhost:3000/audiences/1/export -o audience_1.csv
```

---

## 6. Running the server

Once your code is implemented to match these endpoints:

```bash
# Start Postgres
docker compose up -d db

# Run the dev server
npm run dev

# Or build and run
npm run build
npm start
```

Visit (or hit with curl):

* `http://localhost:3000/health` (if you implement a health endpoint)
* Or start directly with `/identify` and `/track` as shown above.

---

## 7. Optional: Warehouse Integration (Snowflake / BigQuery)

If you want to experiment with a warehouse:

1. **Export data from Postgres**
   For example:

   ```bash
   # Export profiles
   docker exec -t <db-container-id> \
     psql -U cdp -d cdp -c "\COPY profiles TO STDOUT WITH CSV HEADER" \
     > profiles.csv

   # Export events
   docker exec -t <db-container-id> \
     psql -U cdp -d cdp -c "\COPY events TO STDOUT WITH CSV HEADER" \
     > events.csv
   ```

2. **Load into a warehouse (pick one)**

   * Snowflake: Use the web UI or `snowsql` to create tables and `COPY INTO` from staged files.
   * BigQuery: Use the BigQuery web UI “Create table” from local file.

3. **Run audience queries in the warehouse**
   Example (BigQuery-style SQL):

   ```sql
   SELECT email
   FROM profiles
   WHERE total_spend > 100;
   ```

You can then honestly say this project uses:

* Postgres for operational storage
* A warehouse for analytics / ad-hoc audiences

while keeping the core stack simple.

## ETL: Export profiles from Postgres to BigQuery

To simulate a hybrid audiences setup (operational store + warehouse), this repo includes a tiny ETL script that exports `profiles` from Postgres into BigQuery.

### Setup

1. **Create a BigQuery project + service account**

   - Create a Google Cloud project (or reuse an existing one).
   - Enable the **BigQuery API**.
   - Create a **service account** with `BigQuery Data Editor` (or similar) permissions.
   - Download the JSON key file.

2. **Set environment variables**

   In the backend `.env`:

   ```env
   DATABASE_URL=postgres://cdp:cdp@localhost:5433/cdp  # adjust port if needed

   BIGQUERY_PROJECT_ID=your-gcp-project-id
   BIGQUERY_DATASET=mini_cdp
   BIGQUERY_TABLE_PROFILES=profiles_export


---

## 8. Next Steps / Ideas

* Add authentication for API access
* Build a tiny React/Next.js UI to view profiles/events/audiences
* Add a webhook-based activation endpoint (e.g., POST to a mock email system)
* Introduce near-real-time audience updates (e.g., using a job queue instead of pure batch)

---

## Quick walkthrough for reviewers (2–3 minutes)

This demo shows how a checkout platform can use a **hybrid audience** – combining warehouse-style aggregates and real-time session context – to decide which experience to show at checkout.

1. **Start the stack**

   - Backend (Node + Postgres):
     - `docker compose up -d db`
     - `npm run dev`
   - Frontend (React UI):
     - `cd ui`
     - `npm run dev`
   - Open the UI at `http://localhost:5173`.

2. **Simulate a checkout**

   - In **“Simulate a Checkout”**, enter:
     - Email and/or User ID
     - Checkout amount (e.g. `120.00`)
     - Category (e.g. `Concert ticket`)
   - Click **“Run checkout simulation”**.
   - Under the hood, the app:
     - Calls `/identify` to upsert a unified profile (with traits that could come from a warehouse/CRM).
     - Calls `/track` with a `purchase` event, amount, and category.
     - Rebuilds a **“High value last 30 days”** audience in the CDP.

3. **See the data flow**

   At the top, the “Data Flow” strip lights up as the simulation runs:

   1. Checkout event on a partner site  
   2. CDP collects & unifies identity (`/identify` + `/track`)  
   3. Hybrid audience evaluated (warehouse + real-time)  
   4. Experience decision for this shopper  

4. **Inspect profiles and events**

   - On the right, under **“Profiles & Events”**, a new profile appears with:
     - `total_spend`, `total_orders`, `last_seen_at` (modeled as warehouse-style aggregates)
     - A list of events (real-time event stream)
   - Click a profile to see:
     - The full JSON representation (identity + traits)
     - The ordered event history (including the checkout you just simulated)

5. **Understand the hybrid audience logic**

   - In **“Hybrid Audience Evaluation”**, the UI explains:
     - **Warehouse-style signals**: total spend, recency, high-value segment membership.
     - **Real-time signals**: this session’s amount + category (e.g. high-value concert checkout).
   - The hybrid audience is **intersection-based**:
     - High LTV customer **and** high-intent, high-value session → qualifies for a **premium experience**.
     - Only one side (warehouse or real-time) → gets loyalty or acquisition-style experiences.
     - Neither → falls back to a control / generic experience.

6. **Review CDP audiences and activation**

   - In **“CDP Audiences (Warehouse-centric)”**, you can:
     - See the **“High value last 30 days”** audience maintained by the CDP.
     - Click **Rebuild** to recompute membership from profile/event tables.
     - Click **Export CSV** to simulate syncing this audience to downstream channels.

7. **Where to look in the code**

   - **CDP API & data model**: `src/index.ts`
     - `/identify`, `/track`, `/audiences`, `/audiences/:id/rebuild`, `/audiences/:id/export`
   - **Hybrid audience + UI logic**: `ui/src/App.tsx`
     - Checkout simulation, data flow visualization, hybrid audience evaluation.
   - **Warehouse-style export (optional)**: `etl/export_profiles_to_bigquery.ts`
     - Minimal ETL script showing how profile aggregates would be landed in a warehouse (e.g. BigQuery) for deeper audience modeling.
