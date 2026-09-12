// A setup guide that knows what you have already done.
//
// Written for someone who has never deployed anything. Each step shows whether
// it is already satisfied on this deployment, so the page is a checklist rather
// than a wall of instructions, and nobody has to guess which part applies.
import { config } from "@/config";
import { dbStatus } from "@/lib/db";
export const dynamic = "force-dynamic";

const wallets = Object.entries(config.wallets).filter(([, v]) => Boolean(v));
const hasWallet = wallets.length > 0;
const hasMongoVar = Boolean(process.env.MONGODB_URI);
const hasPool = Boolean(config.pool.address);

const VARS: [string, string][] = [
  ["ETH_ADDRESS", "Ethereum, and every EVM chain that shares the address"],
  ["BTC_ADDRESS", "Bitcoin"],
  ["SOL_ADDRESS", "Solana"],
  ["ETC_ADDRESS", "Ethereum Classic"],
  ["BSC_ADDRESS", "BNB Chain"],
  ["TRX_ADDRESS", "TRON"],
];

function Step({ n, title, done, optional, children }: { n: number; title: string; done: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <section className="card mb-4">
      <div className="flex items-start gap-3">
        <span className={"shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold " + (done ? "bg-emerald-900 text-emerald-200" : "bg-neutral-800 text-neutral-300")}>
          {done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="mt-0 mb-1 normal-case tracking-normal text-base text-neutral-100">
            {title} {optional && <span className="badge badge-token ml-1 align-middle">optional</span>}
          </h2>
          <div className={done ? "muted" : "text-neutral-300"}>{children}</div>
        </div>
      </div>
    </section>
  );
}

export default async function Setup() {
  // Only asked when the variable exists, so an unconfigured install does not
  // sit here waiting on a connection that was never going to happen.
  const db = hasMongoVar ? await dbStatus() : null;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="mb-1">Setup</h1>
      <p className="muted mb-6">
        Everything below can be done from a phone. Nothing here needs a terminal, and nothing
        costs money.
      </p>

      <Step n={1} title="Put it on the internet" done>
        You are reading this, so it is already running. If you used the Deploy button, it is
        on a free Vercel account, in a copy of the project under your own GitHub. We cannot
        see it and it costs nothing.
      </Step>

      <Step n={2} title="Watch your own wallets" done={hasWallet}>
        {hasWallet ? (
          <p className="mb-0">
            Watching {wallets.length} address{wallets.length === 1 ? "" : "es"}:{" "}
            {wallets.map(([k]) => k.toUpperCase()).join(", ")}. Add more the same way.
          </p>
        ) : (
          <>
            <p className="mb-2">Right now this is showing sample numbers. To watch real wallets:</p>
            <ol className="list-decimal pl-5 space-y-1 mb-3">
              <li>Open <span className="text-neutral-100">vercel.com</span> and sign in.</li>
              <li>Tap your project, then <span className="text-neutral-100">Settings</span>, then <span className="text-neutral-100">Environment Variables</span>.</li>
              <li>Add a name from the list below, paste your public address as the value, and save.</li>
              <li>Go to <span className="text-neutral-100">Deployments</span>, tap the newest one, then <span className="text-neutral-100">Redeploy</span>.</li>
            </ol>
            <div className="tablewrap mb-3"><table>
              <thead><tr><th>Name</th><th>Covers</th></tr></thead>
              <tbody>{VARS.map(([k, v]) => (
                <tr key={k}><td className="text-neutral-100">{k}</td><td className="muted">{v}</td></tr>
              ))}</tbody>
            </table></div>
            <p className="err text-xs mb-0">
              Use a receiving address, the one you give people to pay you. Never a private key or a
              seed phrase. This app has no field for one and no code that could spend anything.
            </p>
          </>
        )}
      </Step>

      <Step n={3} title="Remember history" done={Boolean(db?.ok)} optional>
        {db?.ok ? (
          <p className="mb-0">
            Connected, {db.ms}ms. Purchases, swaps and the value-over-time charts are on.
          </p>
        ) : (
          <>
            <p className="mb-2">
              Balances tell you what you hold now, not what you held last month. A free database
              adds the purchase log, swaps, and the charts that show change over time. Holdings
              work fine without it.
            </p>
            {hasMongoVar && db && !db.ok && (
              <p className="err text-xs mb-2">
                A connection string is set but the connection failed: {db.error}. The two usual
                causes are leaving the angle brackets around the password, and the database user
                not having access.
              </p>
            )}
            <ol className="list-decimal pl-5 space-y-1 mb-3">
              <li>Go to <span className="text-neutral-100">mongodb.com/atlas</span> and create a free account.</li>
              <li>Create a cluster and pick the <span className="text-neutral-100">Free</span> tier. It stays free.</li>
              <li>When it asks, create a database user. Save the username and password somewhere.</li>
              <li>Under <span className="text-neutral-100">Network Access</span>, allow access from anywhere. Vercel has no fixed address to allow instead.</li>
              <li>Tap <span className="text-neutral-100">Connect</span>, then <span className="text-neutral-100">Drivers</span>, and copy the connection string.</li>
              <li>In Vercel, add it as <span className="text-neutral-100">MONGODB_URI</span> and redeploy.</li>
            </ol>
            <p className="text-xs mb-0">
              <strong className="text-neutral-100">The one that catches everyone:</strong> the string
              you copy contains <code className="text-neutral-100">&lt;db_password&gt;</code>. Replace
              that whole thing, angle brackets included, with your actual password. Leaving the
              brackets in gives an authentication error that looks exactly like a wrong password.
            </p>
          </>
        )}
      </Step>

      <Step n={4} title="Track mining payouts" done={hasPool} optional>
        {hasPool ? (
          <p className="mb-0">Reading payouts for the address set in POOL_ADDRESS.</p>
        ) : (
          <p className="mb-0">
            If you mine, add <span className="text-neutral-100">POOL_ADDRESS</span> in Vercel set to
            the payout address you registered with your pool, and redeploy. Only 2miners is supported.
            Skip this if you do not mine.
          </p>
        )}
      </Step>

      <Step n={5} title="Put it on your home screen" done={false} optional>
        <p className="mb-0">
          On iPhone open this page in Safari, tap Share, then Add to Home Screen. On Android open
          the Chrome menu and tap Install app. It then opens full screen with its own icon and a
          tab bar along the bottom.
        </p>
      </Step>

      <p className="muted text-xs mt-6">
        Changes to environment variables only take effect after a redeploy. If something looks
        wrong after you change one, check <a href="/status">Status</a>, which shows what
        responded and what did not.
      </p>
    </div>
  );
}
