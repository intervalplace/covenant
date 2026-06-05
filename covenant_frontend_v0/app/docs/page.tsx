// docs/page.tsx
import Link from "next/link";

export default function DocsPage() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header style={{ marginBottom: 48 }}>
        <nav className="row" style={{ gap: 14, marginBottom: 32 }}>
          <Link className="muted" href="/">Market</Link>
          <Link className="muted" href="/about">About</Link>
          <Link className="muted" href="/docs">Docs</Link>
        </nav>

        <div className="faint" style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase" }}>
          Protocol docs
        </div>

        <h1 style={{ margin: "12px 0 0", fontSize: 52, lineHeight: 1.05 }}>
          Covenant Documentation
        </h1>

        <p className="muted" style={{ marginTop: 16, fontSize: 18 }}>
          Covenant separates permission from custody.
        </p>
      </header>

      <article className="card" style={{ display: "grid", gap: 30, lineHeight: 1.7 }}>
        <section>
          <h2>Core Rule</h2>
          <p className="muted">
            Execution is valid only when current authorization exists. Authorization is not custody, deposit, or standing control. It is a revocable condition checked at settlement time.
          </p>
        </section>

        <section>
          <h2>Roles</h2>

          <h3>User</h3>
          <p className="muted">
            The user signs a bounded authorization. Assets remain in the user wallet.
          </p>

          <h3>Executor</h3>
          <p className="muted">
            The executor submits settlement transactions. The executor may pay gas, but does not receive custody or standing authority over user assets.
          </p>

          <h3>Settlement Contract</h3>
          <p className="muted">
            The settlement contract verifies authorization, validity windows, revocation state, proof data, and transfer conditions before execution.
          </p>
        </section>

        <section>
          <h2>CSD / USDC Flow</h2>
          <ol className="muted">
            <li>Seller creates a CSD sell offer.</li>
            <li>Buyer selects the offer.</li>
            <li>Buyer enters a one-time CSD receive script.</li>
            <li>Buyer signs a bounded USDC authorization.</li>
            <li>Authorization is locked for a short settlement window.</li>
            <li>Seller sends native CSD.</li>
            <li>Seller waits for the CSD transaction to be included in a block.</li>
            <li>Seller submits the CSD transaction id.</li>
            <li>Covenant verifies the proof and settles USDC if all conditions match.</li>
          </ol>
        </section>

        <section>
          <h2>Settlement Locks</h2>
          <p className="muted">
            A settlement lock temporarily protects a specific authorization while the seller completes proof-based settlement.
            If the window expires without final settlement, the lock should release, the buyer can revoke, and the sell offer can return to the book.
          </p>
        </section>

        <section>
          <h2>WBTC / USDC Flow</h2>
          <p className="muted">
            WBTC / USDC is the planned atomic market. Because both sides settle inside Ethereum, execution can be verified and completed in one environment without external proof.
          </p>
        </section>

        <section>
          <h2>Security Boundaries</h2>
          <ul className="muted">
            <li>No asset deposit into Covenant.</li>
            <li>No internal user balances.</li>
            <li>No standing execution authority.</li>
            <li>Authorization owner controls revocation outside active settlement locks.</li>
            <li>Settlement requires proof matching the signed authorization.</li>
            <li>Genesis hash, trade intent hash, script hash, amount, confirmations, and consumed transaction state are checked.</li>
          </ul>
        </section>

        <section>
          <h2>Launch Status</h2>
          <p className="muted">
            Covenant v0 is experimental software. It is intended to demonstrate authorization-based settlement with strict limits and small trade sizes.
          </p>
        </section>
      </article>
    </main>
  );
}
