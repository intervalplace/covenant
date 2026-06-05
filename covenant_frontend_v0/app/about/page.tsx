// about/page.tsx
import Link from "next/link";

export default function AboutPage() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header style={{ marginBottom: 48 }}>
        <nav className="row" style={{ gap: 14, marginBottom: 32 }}>
          <Link className="muted" href="/">Market</Link>
          <Link className="muted" href="/about">About</Link>
          <Link className="muted" href="/docs">Docs</Link>
        </nav>

        <div className="faint" style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase" }}>
          Covenant v0
        </div>

        <h1 style={{ margin: "12px 0 0", fontSize: 52, lineHeight: 1.05 }}>
          Execution requires current authorization.
        </h1>

        <p className="muted" style={{ marginTop: 16, fontSize: 18 }}>
          Covenant is a settlement protocol where assets remain with users and execution only occurs inside explicit permission.
        </p>
      </header>

      <article className="card" style={{ display: "grid", gap: 28, lineHeight: 1.7 }}>
        <section>
          <h2>Why Covenant Exists</h2>
          <p className="muted">
            Most exchanges begin by taking custody. A user deposits assets, receives an internal balance, and the system executes from authority granted earlier.
            Covenant takes the opposite approach. Assets remain in user wallets. Execution is only valid when a bounded, unrevoked authorization permits settlement.
          </p>
        </section>

        <section>
          <h2>The Model</h2>
          <p className="muted">
            Covenant separates authorization, execution, and settlement. Users authorize. Executors submit. Settlement verifies.
            If permission has expired, been revoked, exceeds its boundary, or fails proof verification, execution fails.
          </p>
        </section>

        <section>
          <h2>CSD / USDC</h2>
          <p className="muted">
            The first Covenant market is CSD / USDC. It demonstrates cross-system settlement: native CSD moves on Compute Substrate, while USDC settles on Ethereum only after a matching CSD proof is verified.
            Because CSD and Ethereum do not share one execution environment, this market uses settlement locks, proof windows, confirmations, consumed transaction checks, and strict trade matching.
          </p>
        </section>

        <section>
          <h2>WBTC / USDC</h2>
          <p className="muted">
            WBTC / USDC is the next planned Covenant market. It demonstrates the simpler atomic case: both assets live in the same execution environment, so settlement can occur directly from current authorization without external proof.
          </p>
        </section>

        <section>
          <h2>Revocation</h2>
          <p className="muted">
            Revocation removes execution authority. The user does not exit by withdrawing from Covenant. The user exits by ending permission.
          </p>
        </section>

        <section>
          <h2>Current Scope</h2>
          <p className="muted">
            Covenant v0 demonstrates authorization-based settlement, bounded execution authority, revocation enforcement, proof-based settlement, settlement windows, and cross-system coordination.
          </p>
        </section>
      </article>
    </main>
  );
}
