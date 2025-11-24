import React, { useEffect, useState } from "react";

const API_BASE = "http://localhost:3000";

interface Profile {
  id: string;
  email: string | null;
  user_id: string | null;
  anonymous_id: string | null;
  total_orders: number;
  total_spend: string | number;
  last_seen_at: string;
}

interface EventRecord {
  id: string;
  event_type: string;
  properties: any;
  occurred_at: string;
}

interface Audience {
  id: number;
  name: string;
  definition: any;
  created_at: string;
  last_built_at: string | null;
}

interface ScenarioContext {
  amount: number;
  merchant: string;
  category: string;
  occurredAt: string;
}

interface HybridEvaluation {
  isWarehouseSegment: boolean;
  isRealtimeQualified: boolean;
  isHybridMember: boolean;
  totalSpend: number;
  lastSeenDays: number | null;
  amount: number;
  category: string;
}

const App: React.FC = () => {
  // Scenario (checkout) state
  const [scenarioEmail, setScenarioEmail] = useState("fan@example.com");
  const [scenarioUserId, setScenarioUserId] = useState("ticket_buyer_123");
  const [scenarioAmount, setScenarioAmount] = useState("120.00");
  const [scenarioCategory, setScenarioCategory] = useState("Concert ticket");
  const [scenarioStep, setScenarioStep] = useState<number>(0);
  const [scenarioContext, setScenarioContext] = useState<ScenarioContext | null>(
    null
  );

  // Data state
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [profileEvents, setProfileEvents] = useState<EventRecord[]>([]);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [highValueAudienceId, setHighValueAudienceId] = useState<number | null>(
    null
  );
  const [hybridEval, setHybridEval] = useState<HybridEvaluation | null>(null);

  // Messages/loading
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingScenario, setLoadingScenario] = useState(false);

  function showMessage(msg: string) {
    setMessage(msg);
    setError(null);
  }

  function showError(msg: string) {
    setError(msg);
    setMessage(null);
  }

  async function fetchProfiles() {
    try {
      const res = await fetch(`${API_BASE}/profiles`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      setProfiles(data.profiles || []);
    } catch (err: any) {
      console.error("fetchProfiles error:", err);
      showError("Failed to load profiles");
    }
  }

  async function fetchAudiences() {
    try {
      const res = await fetch(`${API_BASE}/audiences`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      const list: Audience[] = data.audiences || [];
      setAudiences(list);
      const hv = list.find(
        (a) => a.name.toLowerCase() === "high value last 30 days"
      );
      setHighValueAudienceId(hv ? hv.id : null);
    } catch (err: any) {
      console.error("fetchAudiences error:", err);
      showError("Failed to load audiences");
    }
  }

  useEffect(() => {
    fetchProfiles();
    fetchAudiences();
  }, []);

  async function loadProfileEvents(profileId: string) {
    try {
      const res = await fetch(`${API_BASE}/profiles/${profileId}/events`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      setProfileEvents(data.events || []);
    } catch (err: any) {
      console.error("loadProfileEvents error:", err);
      showError("Failed to load profile events");
    }
  }

  async function selectProfile(p: Profile) {
    setSelectedProfile(p);
    setHybridEval(
      scenarioContext ? evaluateHybridAudience(p, scenarioContext) : null
    );
    await loadProfileEvents(p.id);
  }

  async function ensureDefaultHighValueAudience() {
    if (highValueAudienceId) return highValueAudienceId;

    const definition = {
      min_total_spend: 100,
      days_since_last_event: 30,
    };

    const res = await fetch(`${API_BASE}/audiences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "High value last 30 days",
        definition,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create default audience");
    }

    const body = await res.json();
    const aud: Audience = body.audience;
    setAudiences((prev) => [aud, ...prev]);
    setHighValueAudienceId(aud.id);
    return aud.id;
  }

  function evaluateHybridAudience(
    profile: Profile | null,
    ctx: ScenarioContext | null
  ): HybridEvaluation | null {
    if (!profile || !ctx) return null;

    const totalSpend = Number(profile.total_spend || 0);
    const now = Date.now();
    let lastSeenDays: number | null = null;
    if (profile.last_seen_at) {
      const last = new Date(profile.last_seen_at).getTime();
      lastSeenDays = (now - last) / (1000 * 60 * 60 * 24);
    }

    // Treat total_spend as a warehouse-style aggregate (e.g., lifetime or 90-day spend).
    const isWarehouseSegment = totalSpend >= 300; // “high LTV / high-value segment”

    // Real-time session: high-intent, high-value concert checkout
    const isRealtimeQualified =
      ctx.amount >= 100 && ctx.category.toLowerCase().includes("concert");

    const isHybridMember = isWarehouseSegment && isRealtimeQualified;

    return {
      isWarehouseSegment,
      isRealtimeQualified,
      isHybridMember,
      totalSpend,
      lastSeenDays,
      amount: ctx.amount,
      category: ctx.category,
    };
  }

  function buildOfferExplanation(e: HybridEvaluation | null): string | null {
    if (!e) return null;

    if (e.isHybridMember) {
      return (
        "Hybrid audience: shopper is a high-value customer (warehouse aggregate) " +
        "and currently in a high-intent concert checkout (real-time). " +
        "Show a premium, revenue-maximizing offer (e.g., VIP upgrade, add-on experiences)."
      );
    }

    if (e.isWarehouseSegment && !e.isRealtimeQualified) {
      return (
        "Warehouse segment only: customer is high-value overall, " +
        "but this session doesn’t meet the real-time criteria. " +
        "Show a softer loyalty or retention offer."
      );
    }

    if (!e.isWarehouseSegment && e.isRealtimeQualified) {
      return (
        "Real-time only: this checkout is high value, " +
        "but the customer is not yet in the high-LTV segment. " +
        "Show an acquisition or cross-sell offer with lower risk."
      );
    }

    return (
      "Outside the hybrid audience: use a generic or control experience to protect the core checkout."
    );
  }

  async function runCheckoutSimulation() {
    setLoadingScenario(true);
    setMessage(null);
    setError(null);
    setHybridEval(null);
    setScenarioStep(0);

    try {
      const email = scenarioEmail.trim();
      const userId = scenarioUserId.trim();
      const amountNum = Number(scenarioAmount || "0");

      if (!email && !userId) {
        throw new Error("Please enter an email or user ID for the shopper.");
      }

      // 1) Checkout event occurs
      setScenarioStep(1);

      // 2) CDP collects & unifies identity (simulate traits that could come from warehouse)
      const identifyRes = await fetch(`${API_BASE}/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email || undefined,
          user_id: userId || undefined,
          traits: {
            merchant: "TicketingPartner",
            vertical: "Events",
            // Example of attributes that would normally be synced from a warehouse/CRM
            crm_ltv_bucket: "HIGH", // pretend this came from BigQuery/warehouse
            crm_region: "US",
          },
        }),
      });

      if (!identifyRes.ok) {
        const body = await identifyRes.json().catch(() => ({}));
        throw new Error(body.error || "Identify failed");
      }
      const identifyBody = await identifyRes.json();
      const profileAfterIdentify: Profile | undefined = identifyBody.profile;

      setScenarioStep(2);

      // 3) Track the purchase event (real-time signal)
      const eventOccurredAt = new Date().toISOString();
      const merchant = "TicketingPartner";
      const category = scenarioCategory || "Concert ticket";

      const trackRes = await fetch(`${API_BASE}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "purchase",
          user_id: userId || undefined,
          email: email || undefined,
          properties: {
            merchant,
            category,
            amount: amountNum,
            currency: "USD",
          },
          occurred_at: eventOccurredAt,
        }),
      });

      if (!trackRes.ok) {
        const body = await trackRes.json().catch(() => ({}));
        throw new Error(body.error || "Track failed");
      }

      const trackBody = await trackRes.json();
      const profileAfterTrack: Profile | undefined = trackBody.profile;

      const ctx: ScenarioContext = {
        amount: amountNum,
        merchant,
        category,
        occurredAt: eventOccurredAt,
      };
      setScenarioContext(ctx);

      setScenarioStep(3);

      // 4) Maintain a "High value last 30 days" audience in the CDP
      const audienceId = await ensureDefaultHighValueAudience();

      const rebuildRes = await fetch(
        `${API_BASE}/audiences/${audienceId}/rebuild`,
        {
          method: "POST",
        }
      );
      if (!rebuildRes.ok) {
        const body = await rebuildRes.json().catch(() => ({}));
        throw new Error(body.error || "Failed to rebuild audience");
      }

      // Refresh lists
      await Promise.all([fetchProfiles(), fetchAudiences()]);

      const p = profileAfterTrack || profileAfterIdentify || null;
      if (p) {
        setSelectedProfile(p);
        await loadProfileEvents(p.id);
        const evalResult = evaluateHybridAudience(p, ctx);
        setHybridEval(evalResult);
      }

      setScenarioStep(4);
      showMessage("Checkout simulation complete.");
    } catch (err: any) {
      console.error("runCheckoutSimulation error:", err);
      showError(err.message || "Failed to run checkout simulation.");
      setScenarioStep(0);
    } finally {
      setLoadingScenario(false);
    }
  }

  function handleExportAudience(id: number) {
    window.open(`${API_BASE}/audiences/${id}/export`, "_blank");
  }

  const stepStyle = (stepNumber: number): React.CSSProperties => ({
    flex: 1,
    padding: "0.75rem",
    borderRadius: 8,
    border:
      scenarioStep >= stepNumber
        ? "2px solid #3498db"
        : "1px solid #ddd",
    background:
      scenarioStep >= stepNumber ? "#eaf4ff" : "#f8f8f8",
    fontSize: 13,
  });

  const offerExplanation = buildOfferExplanation(hybridEval);

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: "1.5rem",
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      <h1>Mini CDP · Hybrid Audience Checkout Demo</h1>
      <p style={{ color: "#555", maxWidth: 840 }}>
        This demo shows how a checkout platform can use a{" "}
        <strong>hybrid audience</strong> – combining{" "}
        <strong>warehouse-style aggregates</strong> (e.g., lifetime spend) and{" "}
        <strong>real-time session signals</strong> (current basket, amount) – to decide
        which offer or experience to show at checkout.
      </p>

      {message && (
        <div
          style={{
            background: "#e6ffed",
            border: "1px solid #2ecc71",
            padding: "0.5rem 0.75rem",
            marginBottom: "1rem",
            borderRadius: 4,
          }}
        >
          {message}
        </div>
      )}
      {error && (
        <div
          style={{
            background: "#ffecec",
            border: "1px solid #e74c3c",
            padding: "0.5rem 0.75rem",
            marginBottom: "1rem",
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      {/* Data flow diagram */}
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: "1rem",
          marginBottom: "1rem",
        }}
      >
        <h2>Data Flow · Checkout → CDP → Hybrid Audience → Experience</h2>
        <p style={{ fontSize: 13, color: "#666" }}>
          The goal is to maximize revenue and relevance at checkout while protecting the
          core purchase flow.
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            alignItems: "stretch",
            marginTop: "0.5rem",
          }}
        >
          <div style={stepStyle(1)}>
            <strong>1. Checkout event</strong>
            <div>A shopper buys a concert ticket on a partner site.</div>
          </div>
          <div style={{ alignSelf: "center" }}>→</div>
          <div style={stepStyle(2)}>
            <strong>2. Collect &amp; unify</strong>
            <div>
              CDP ingests <code>/identify</code> + <code>/track</code>, updates the
              unified profile, and aggregates spend.
            </div>
          </div>
          <div style={{ alignSelf: "center" }}>→</div>
          <div style={stepStyle(3)}>
            <strong>3. Hybrid audience</strong>
            <div>
              A high-value base segment from the warehouse is intersected with real-time
              checkout context.
            </div>
          </div>
          <div style={{ alignSelf: "center" }}>→</div>
          <div style={stepStyle(4)}>
            <strong>4. Experience decision</strong>
            <div>
              The platform chooses a premium, loyalty, acquisition, or control experience
              for this shopper.
            </div>
          </div>
        </div>
      </section>

      {/* Main layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: "1rem",
          alignItems: "flex-start",
        }}
      >
        {/* Left: Simulation + audiences + hybrid explanation */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Simulation */}
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: "1rem",
            }}
          >
            <h2>Simulate a Checkout</h2>
            <p style={{ fontSize: 13, color: "#666" }}>
              Enter simple shopper details, then run the simulation. The app will send
              identity and purchase events into the CDP, rebuild a high-value audience,
              and evaluate a hybrid audience for this session.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runCheckoutSimulation();
              }}
              style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}
            >
              <div>
                <label>Email</label>
                <input
                  type="email"
                  value={scenarioEmail}
                  onChange={(e) => setScenarioEmail(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>User ID</label>
                <input
                  type="text"
                  value={scenarioUserId}
                  onChange={(e) => setScenarioUserId(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>Checkout amount (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={scenarioAmount}
                  onChange={(e) => setScenarioAmount(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>Category</label>
                <input
                  type="text"
                  value={scenarioCategory}
                  onChange={(e) => setScenarioCategory(e.target.value)}
                  style={{ width: "100%" }}
                />
                <small style={{ fontSize: 11, color: "#777" }}>
                  e.g. "Concert ticket", "Food delivery", "Rideshare"
                </small>
              </div>
              <button
                type="submit"
                disabled={loadingScenario}
                style={{
                  padding: "0.5rem 0.9rem",
                  marginTop: "0.25rem",
                  cursor: loadingScenario ? "wait" : "pointer",
                }}
              >
                {loadingScenario
                  ? "Running checkout simulation..."
                  : "Run checkout simulation"}
              </button>
            </form>
          </section>

          {/* Hybrid audience explanation */}
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: "1rem",
            }}
          >
            <h2>Hybrid Audience Evaluation</h2>
            <p style={{ fontSize: 13, color: "#666" }}>
              A hybrid audience combines:
              <br />
              <strong>Warehouse-style signals</strong> (aggregated spend, orders, LTV){" "}
              and <strong>real-time signals</strong> (this session’s basket and intent).
            </p>

            {hybridEval && selectedProfile && scenarioContext ? (
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.75rem",
                    marginTop: "0.5rem",
                  }}
                >
                  <div
                    style={{
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      padding: "0.5rem",
                    }}
                  >
                    <strong style={{ fontSize: 13 }}>Warehouse-style signals</strong>
                    <ul
                      style={{
                        margin: "0.5rem 0 0",
                        paddingLeft: "1.1rem",
                        fontSize: 12,
                      }}
                    >
                      <li>
                        Total spend: <strong>${hybridEval.totalSpend.toFixed(2)}</strong>{" "}
                        (threshold: ≥ $300)
                      </li>
                      <li>
                        Last seen:{" "}
                        {hybridEval.lastSeenDays !== null
                          ? `${hybridEval.lastSeenDays.toFixed(1)} days ago`
                          : "n/a"}
                      </li>
                      <li>
                        Segment membership:{" "}
                        {hybridEval.isWarehouseSegment ? (
                          <span style={{ color: "#27ae60" }}>High-value segment</span>
                        ) : (
                          <span style={{ color: "#c0392b" }}>Not high-value</span>
                        )}
                      </li>
                    </ul>
                  </div>
                  <div
                    style={{
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      padding: "0.5rem",
                    }}
                  >
                    <strong style={{ fontSize: 13 }}>Real-time session signals</strong>
                    <ul
                      style={{
                        margin: "0.5rem 0 0",
                        paddingLeft: "1.1rem",
                        fontSize: 12,
                      }}
                    >
                      <li>
                        Current amount:{" "}
                        <strong>${hybridEval.amount.toFixed(2)}</strong> (threshold: ≥
                        $100)
                      </li>
                      <li>Category: {hybridEval.category}</li>
                      <li>
                        Session qualification:{" "}
                        {hybridEval.isRealtimeQualified ? (
                          <span style={{ color: "#27ae60" }}>High-intent session</span>
                        ) : (
                          <span style={{ color: "#c0392b" }}>Standard session</span>
                        )}
                      </li>
                    </ul>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "0.75rem",
                    padding: "0.75rem",
                    borderRadius: 6,
                    border: "1px solid #3498db",
                    background: "#eaf4ff",
                    fontSize: 13,
                  }}
                >
                  <strong>
                    Hybrid audience membership:{" "}
                    {hybridEval.isHybridMember ? (
                      <span style={{ color: "#27ae60" }}>YES</span>
                    ) : (
                      <span style={{ color: "#c0392b" }}>NO</span>
                    )}
                  </strong>
                  {offerExplanation && (
                    <div style={{ marginTop: "0.25rem" }}>{offerExplanation}</div>
                  )}
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "#777" }}>
                Run a checkout simulation and select a profile to see the hybrid audience
                decision.
              </p>
            )}
          </section>

          {/* CDP audiences */}
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: "1rem",
            }}
          >
            <h2>CDP Audiences (Warehouse-centric)</h2>
            <p style={{ fontSize: 13, color: "#666" }}>
              The CDP maintains longer-lived audiences (e.g., “High value last 30 days”)
              using aggregated profile/event data. Real-time logic then intersects these
              audiences with current session context at decision time.
            </p>
            {audiences.length === 0 ? (
              <p style={{ color: "#777" }}>No audiences yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {audiences.map((a) => (
                  <li
                    key={a.id}
                    style={{
                      borderBottom: "1px solid #eee",
                      padding: "0.5rem 0",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <div>
                        <strong>{a.name}</strong> (id: {a.id})
                      </div>
                      <div style={{ fontSize: 12, color: "#777" }}>
                        Last built: {a.last_built_at || "never"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      <button
                        type="button"
                        onClick={() =>
                          fetch(`${API_BASE}/audiences/${a.id}/rebuild`, {
                            method: "POST",
                          })
                            .then(() => {
                              showMessage(
                                `Rebuilt audience ${a.id} (${a.name})`
                              );
                              fetchAudiences();
                            })
                            .catch((err) => {
                              console.error(err);
                              showError("Failed to rebuild audience");
                            })
                        }
                        style={{ padding: "0.25rem 0.5rem" }}
                      >
                        Rebuild
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportAudience(a.id)}
                        style={{ padding: "0.25rem 0.5rem" }}
                      >
                        Export CSV
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right: Profiles & events */}
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: "1rem",
            maxHeight: "80vh",
            overflowY: "auto",
          }}
        >
          <h2>Profiles &amp; Events</h2>
          <p style={{ fontSize: 13, color: "#666" }}>
            Profiles are updated with each checkout. Think of <code>total_spend</code>{" "}
            and <code>total_orders</code> as warehouse-style aggregates and the{" "}
            <code>events</code> list as the real-time event stream that feeds the CDP.
          </p>

          {profiles.length === 0 ? (
            <p style={{ color: "#777" }}>
              No profiles yet. Run the checkout simulation on the left to create one.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: "0.5rem",
              }}
            >
              {profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProfile(p)}
                  style={{
                    textAlign: "left",
                    padding: "0.5rem",
                    borderRadius: 6,
                    border:
                      selectedProfile && selectedProfile.id === p.id
                        ? "2px solid #3498db"
                        : "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div>
                    <strong>
                      {p.email || p.user_id || p.anonymous_id || "(no ID)"}
                    </strong>
                  </div>
                  <div style={{ fontSize: 12, color: "#777" }}>
                    Orders: {p.total_orders} · Spend: {String(p.total_spend)} ·
                    Last seen:{" "}
                    {p.last_seen_at
                      ? new Date(p.last_seen_at).toLocaleString()
                      : "n/a"}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedProfile && (
            <div style={{ marginTop: "1rem" }}>
              <h3>Selected profile</h3>
              <pre
                style={{
                  background: "#f9f9f9",
                  padding: "0.5rem",
                  borderRadius: 4,
                  fontSize: 12,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(selectedProfile, null, 2)}
              </pre>

              <h4>Events</h4>
              {profileEvents.length === 0 ? (
                <p style={{ color: "#777" }}>No events yet.</p>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                  }}
                >
                  {profileEvents.map((ev) => (
                    <li
                      key={ev.id}
                      style={{
                        borderBottom: "1px solid #eee",
                        padding: "0.5rem 0",
                      }}
                    >
                      <div>
                        <strong>{ev.event_type}</strong> ·{" "}
                        {new Date(ev.occurred_at).toLocaleString()}
                      </div>
                      <pre
                        style={{
                          background: "#f4f4f4",
                          padding: "0.25rem 0.5rem",
                          borderRadius: 4,
                          fontSize: 11,
                          overflowX: "auto",
                        }}
                      >
                        {JSON.stringify(ev.properties, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
