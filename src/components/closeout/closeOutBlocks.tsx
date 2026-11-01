import type { ReactNode } from "react";
import type { CloseOutReport } from "@/lib/closeOutReport";

export interface ReportBlock {
  key: string;
  node: ReactNode;
  section: string;
  sectionNo: string;
  isSectionHead?: boolean;
  keepWithNext?: boolean;
  breakBefore?: boolean;
}

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const usd2 = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const Path = ({ children }: { children: ReactNode }) => <span className="co-path">{children}</span>;
const InApp = ({ children }: { children: ReactNode }) => <div className="co-inapp"><b>In the app</b><span>{children}</span></div>;
const OfflineOnly = () => <div className="co-inapp co-off"><b>Offline only</b><span>Nothing to record in the app.</span></div>;
const OutsideApp = ({ children }: { children: ReactNode }) => <div className="co-inapp co-off"><b>Outside the app</b><span>{children}</span></div>;

function Task({ title, sub, right, note }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; note?: ReactNode }) {
  return (
    <div className="co-task">
      <span className="co-box" aria-hidden="true" />
      <div className="co-task-main">
        <div className="co-task-line"><span className="co-task-title">{title}</span>{right && <span className="co-task-right">{right}</span>}</div>
        {sub && <div className="co-task-sub">{sub}</div>}
        {note}
      </div>
    </div>
  );
}

function SectionHead({ no, title, intro, src }: { no: string; title: string; intro?: string; src?: string }) {
  return (
    <div className="co-sec-head">
      <span className="co-no">{no}</span>
      <h2>{title}</h2>
      {intro && <p>{intro}</p>}
      {src && <span className="co-src">{src}</span>}
    </div>
  );
}

function BlockHead({ title, count, tone, children }: { title: string; count?: string; tone?: "warn" | "bad"; children?: ReactNode }) {
  return (
    <div className="co-block">
      <div className="co-block-head"><h3>{title}</h3>{count && <span className={tone ? `co-count co-${tone}` : "co-count"}>{count}</span>}</div>
      {children}
    </div>
  );
}

export function ContinuedTitle({ no, title }: { no: string; title: string }) {
  return (
    <div className="co-sec-head co-cont">
      <span className="co-no">{no}</span>
      <h2>{title} <span className="co-cont-word">continued</span></h2>
    </div>
  );
}

interface BlockOptions {
  year: number;
  printedAt: string;
  isAuctionClosed: boolean;
}

/**
 * The report as a list of blocks in reading order, for paginateReport
 * (src/lib/reportPagination.ts). Sections 1-4 are what the Dashboard
 * shows once the auction is closed; 5 adds the money totals; 6 is the
 * wrap-up checklist. Each task says what to record in the app.
 */
export function buildCloseOutBlocks(r: CloseOutReport, { year, printedAt, isAuctionClosed }: BlockOptions): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let section = "";
  let sectionNo = "";
  const add = (key: string, node: ReactNode, extra: Partial<ReportBlock> = {}) =>
    blocks.push({ key, node, section, sectionNo, ...extra });
  const head = (no: string, title: string, intro?: string, src?: string, breakBefore = false) => {
    section = title;
    sectionNo = no;
    add(`sec-${no}`, <SectionHead no={no} title={title} intro={intro} src={src} />, { isSectionHead: true, keepWithNext: true, breakBefore });
  };

  // Page 1: masthead and the rule.
  add("mast", (
    <header className="co-mast">
      <span className="co-eyebrow">Orchard Ridge Nursery School · {year} Auction</span>
      <h1>Auction <em>Close-Out</em></h1>
      <div className="co-mast-meta">
        <span>Printed <b>{printedAt}</b></span>
        <span>Source <b>Dashboard, after Close</b></span>
        {!isAuctionClosed && <span className="co-chip">Auction not closed yet: figures can still change</span>}
      </div>
    </header>
  ), { isSectionHead: true });
  add("rule", (
    <div className="co-block">
      <aside className="co-rule-box">
        <span className="co-mark" aria-hidden="true">!</span>
        <h2>Done it offline? Record it in the app too.</h2>
        <div>
          <p>Most of this work happens away from a screen: cash taken at the door, a check handed over in the car park, a prize dropped off on Monday. Each of those must also be recorded in the auction app. Until it is, the app still shows the bidder as unpaid, their receipt is wrong, and the archive won't match the bank deposit.</p>
          <p>Every task says what to do in the app. <strong>Tick the box only when both halves are done.</strong></p>
        </div>
      </aside>
    </div>
  ), { isSectionHead: true });

  // 1. The night in numbers
  head("1", "The night in numbers", "The four figures at the top of the Dashboard once the auction is closed.", "From the Dashboard's stat tiles and Attendance Overview");
  const pending = r.pending.length;
  add("figures", (
    <div className="co-block co-tight">
      <div className="co-figures" style={{ marginTop: "9pt" }}>
        <div className="co-fig co-raised"><span className="co-eyebrow">Total raised</span><span className="co-fig-v">{usd(r.totalRaised)}</span><span className="co-fig-s">Bids, tickets and appeals</span></div>
        <div className="co-fig"><span className="co-eyebrow">Bidders present</span><span className="co-fig-v">{r.checkedIn}<small> / {r.totalBidders}</small></span><span className="co-fig-s">{pct(r.checkedIn, r.totalBidders)}% attendance</span></div>
        <div className="co-fig"><span className="co-eyebrow">Checked out</span><span className="co-fig-v">{r.checkedOut}</span><span className="co-fig-s"><span className={pending ? "co-warn-text" : undefined}>{pending} pending</span> of {r.checkedIn} present</span></div>
        <div className="co-fig"><span className="co-eyebrow">Auction items</span><span className="co-fig-v">{r.itemCount}</span><span className="co-fig-s">In the catalog</span></div>
      </div>
    </div>
  ));
  const a = r.attendance;
  const segs: [string, number, string][] = [
    ["Checked out", a.checkedOut, "--co-seg-1"],
    ["Present, not out", a.presentNotOut, "--co-seg-2"],
    ["Never checked in", a.neverIn, "--co-seg-3"],
    ["Proxy bidders", a.proxies, "--co-seg-4"],
  ];
  add("attendance", (
    <BlockHead title="Attendance" count={`${r.totalBidders} registered`}>
      <div className="co-stack-bar" role="img" aria-label={segs.map(([n, v]) => `${n} ${v}`).join(", ")}>
        {segs.filter(([, v]) => v > 0).map(([n, v, c]) => <span key={n} style={{ flex: v, background: `var(${c})` }} />)}
      </div>
      <div className="co-legend">{segs.map(([n, v, c]) => <div key={n}><i style={{ background: `var(${c})` }} /><span>{n}</span><span className="co-num">{v}</span></div>)}</div>
      <p className="co-note">Proxy bidders never attend, so they are counted apart from no-shows, as on the Dashboard. Closing the auction also marks everyone who won nothing as checked out.</p>
    </BlockHead>
  ));

  // 2. Special winners
  head("2", "Special winners", "The two draws recorded on the Dashboard. The winner fields lock at Close, so save them before closing.", "From the Dashboard's Special Winners card");
  const prizeWho = (w: CloseOutReport["giftCard"]) => w
    ? <div className="co-prize-who"><span className="co-id">#{w.id}</span><strong>{w.name}</strong></div>
    : <p className="co-empty">No winner recorded on the Dashboard.</p>;
  add("prizes", (
    <div className="co-block">
      <div className="co-two">
        <div className="co-prize">
          <span className="co-eyebrow">$500 Amazon Gift Card</span>
          {prizeWho(r.giftCard)}
          {r.giftCard?.checkedOut && <p className="co-note">Drawn after they had checked out, so the app added a Follow-Up row.</p>}
          <div>
            <Task title="Winner told they won" />
            <Task title="Gift card delivered" />
          </div>
        </div>
        <div className="co-prize">
          <span className="co-eyebrow">50/50 Raffle</span>
          {prizeWho(r.raffle)}
          <p className="co-note">50/50 tickets took in {usd2(r.raffleGross)}; the winner's half is {usd2(r.raffleGross / 2)}.</p>
          <div>
            <Task title="Winner told they won" />
            <Task title={`Winner paid ${usd2(r.raffleGross / 2)}`} right={<span className="co-pill co-owner">Offline only</span>} />
          </div>
        </div>
      </div>
    </div>
  ));

  // 3. Post-auction follow-up
  head("3", "Post-auction follow-up", "Money still owed and items still waiting to go home. Work these first. A post-checkout win is an item assigned after the bidder had checked out.", "From the Dashboard's Post-Auction Follow-Up card", true);
  const unpaidTotal = r.pending.reduce((t, p) => t + p.due, 0);
  add("pending-head", (
    <BlockHead title="Still need to check out" count={`${r.pending.length} bidders · ${usd(unpaidTotal)} unpaid`} tone="warn">
      <InApp><Path>Checkout</Path> → find the bidder → take payment → Check Out. Paid bidders still need checking out.</InApp>
    </BlockHead>
  ), { keepWithNext: true });
  if (!r.pending.length) add("pending-none", <p className="co-empty">All present bidders have checked out.</p>);
  for (const p of r.pending) {
    add(`pending-${p.id}`, (
      <Task
        title={<><span className="co-id">#{p.id}</span>{p.name}</>}
        sub={[p.email, p.isProxy ? "proxy bidder with a winning bid" : ""].filter(Boolean).join(" · ")}
        right={p.paid
          ? <span className="co-pill co-paid">Paid</span>
          : p.due
            ? <><span className="co-amt co-due">{usd2(p.due)} due</span><span className="co-pill co-unpaid">Unpaid</span></>
            : <span className="co-pill co-owner">No wins</span>}
      />
    ));
  }
  const followUpTotal = r.followUps.reduce((t, f) => t + f.due, 0);
  add("followup-head", (
    <BlockHead title="Post-checkout item wins" count={`${r.followUps.length} records · ${usd(followUpTotal)} due`}>
      <InApp><Path>Checkout</Path> → find the bidder → take payment for the added item, then reprint or re-email their receipt.</InApp>
    </BlockHead>
  ), { keepWithNext: true });
  if (!r.followUps.length) add("followup-none", <p className="co-empty">No items have been assigned to checked-out bidders.</p>);
  r.followUps.forEach((f, i) => add(`followup-${i}`, (
    <Task
      title={<><span className="co-id">#{f.bidderId}</span>{f.name}</>}
      sub={`Won: ${f.item}`}
      right={<span className={f.due ? "co-amt co-due" : "co-amt"}>{usd2(f.due)} still due</span>}
    />
  )));
  add("noshow-head", <BlockHead title="No-shows (never checked in)" count={`${r.noShows.length} bidders`} tone="bad" />, { keepWithNext: true });
  if (!r.noShows.length) add("noshow-none", <p className="co-empty">Everyone checked in.</p>);
  for (let i = 0; i < r.noShows.length; i += 3) {
    add(`noshow-${i}`, (
      <div className="co-roster">
        {r.noShows.slice(i, i + 3).map((b) => <div key={b.id}><span className="co-id">#{b.id}</span><span>{b.name}<small>{b.email}</small></span></div>)}
      </div>
    ));
  }
  if (r.noShows.length) {
    add("noshow-review", (
      <Task
        title="Reviewed the no-show list"
        sub="None of these bidders has a winning bid or an amount owed. Anyone who does belongs in the checkout list instead."
        note={<InApp>Search the bidder number on <Path>Bid Management</Path>. If someone did attend, check them in and out on the Checkout page so their record isn't left blank.</InApp>}
      />
    ));
  }

  // 4. Proxy bidders
  head("4", "Proxy bidders", "People who bid through a stand-in and weren't in the room. Their winnings need delivering.", "From the Dashboard's Proxy Bidders card · winning-bid counts added");
  add("proxy-inapp", <div className="co-block co-tight"><InApp>Hand over or post the items, then make sure the bidder is checked out and paid on the <Path>Checkout</Path> page. Tick only when both are done.</InApp></div>, { keepWithNext: true });
  if (!r.proxies.length) add("proxy-none", <p className="co-empty">No proxy bidders.</p>);
  for (const p of r.proxies) {
    const title = <><span className="co-id">#{p.id}</span>{p.name}</>;
    add(`proxy-${p.id}`, p.wins
      ? <Task title={title} sub={`${p.wins} winning bid${p.wins === 1 ? "" : "s"} · ${p.checkedOut ? "checked out" : "not checked out yet"}`} right={<span className="co-pill co-unpaid">Proxy</span>} />
      : (
        <div className="co-task">
          <span />
          <div className="co-task-main">
            <div className="co-task-line"><span className="co-task-title">{title}</span><span className="co-pill co-owner">No wins</span></div>
            <div className="co-task-sub">Nothing to deliver.</div>
          </div>
        </div>
      ));
  }

  // 5. Where the money stands
  head("5", "Where the money stands", "What the treasurer will ask for, added up from the same winning bids as Total Raised.", undefined, true);
  add("money", (
    <div className="co-block co-tight">
      <span className="co-suggest">Not on the Dashboard</span>
      <div className="co-two" style={{ marginTop: "10pt" }}>
        <div>
          <div className="co-block-head"><h3>Collected and still owed</h3></div>
          <div className="co-ledger">
            <div><span>Collected at checkout</span><span className="co-num">{usd(r.collected)}</span></div>
            <div><span>Still owed</span><span className="co-num co-warn-text">{usd(r.owed)}</span></div>
            <div className="co-total"><span>All winning bids</span><span className="co-num">{usd(r.winsTotal)}</span></div>
          </div>
          <p className="co-note">Collected is what bidders marked Paid owe for their wins, less any Follow-Up amount still due. Card amounts are before the PayPal fee.</p>
        </div>
        <div>
          <div className="co-block-head"><h3>How people paid</h3></div>
          {r.methods.length ? (
            <table>
              <thead><tr><th>Method</th><th className="co-r">Bidders</th><th className="co-r">Amount</th></tr></thead>
              <tbody>{r.methods.map((m) => (
                <tr key={m.name}><td>{m.name}<span className="co-share"><i style={{ width: `${pct(m.amount, r.collected)}%` }} /></span></td><td className="co-r co-num">{m.count}</td><td className="co-r co-num">{usd(m.amount)}</td></tr>
              ))}</tbody>
              <tfoot><tr><td>Total</td><td className="co-r co-num">{r.methods.reduce((t, m) => t + (m.count ?? 0), 0)}</td><td className="co-r co-num">{usd(r.collected)}</td></tr></tfoot>
            </table>
          ) : <p className="co-empty">No payments recorded yet.</p>}
          <p className="co-note">From the payment method recorded at each checkout.</p>
        </div>
      </div>
    </div>
  ));
  add("sources", (
    <BlockHead title="Where it came from" count="by item category">
      {r.sources.length ? (
        <table>
          <thead><tr><th>Source</th><th className="co-r">Share</th><th className="co-r">Amount</th></tr></thead>
          <tbody>{r.sources.map((s) => (
            <tr key={s.name}><td>{s.name}<span className="co-share"><i style={{ width: `${pct(s.amount, r.winsTotal)}%` }} /></span></td><td className="co-r co-num">{pct(s.amount, r.winsTotal)}%</td><td className="co-r co-num">{usd(s.amount)}</td></tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td><td className="co-r co-num">100%</td><td className="co-r co-num">{usd(r.winsTotal)}</td></tr></tfoot>
        </table>
      ) : <p className="co-empty">No winning bids recorded.</p>}
      <p className="co-note">Winning bids grouped by each item's Category. Every category other than Live Auction, Open Appeal, Raffle Tickets, Auction Tickets and Movie Night counts as Silent Auction.</p>
    </BlockHead>
  ));
  add("top", (
    <BlockHead title="Top five winning bids">
      {r.topWins.length ? (
        <table>
          <thead><tr><th>Item</th><th>Name</th><th className="co-r">Bidder</th><th className="co-r">Winning bid</th></tr></thead>
          <tbody>{r.topWins.map((w, i) => (
            <tr key={`${w.itemId}-${i}`}><td className="co-num">{w.itemId}</td><td>{w.item}</td><td className="co-r co-num">#{w.bidderId}</td><td className="co-r co-num">{usd(w.amount)}</td></tr>
          ))}</tbody>
        </table>
      ) : <p className="co-empty">No winning bids recorded.</p>}
      <p className="co-note">The winning bids, highest first. {r.unsold.length} of {r.itemCount} items had no winning bid; see wrap-up step 7.</p>
    </BlockHead>
  ));

  // 6. Closing the books
  head("6", "Closing the books", "The rest of the close-out, in order. Archive last, once every payment is recorded, so the archived spreadsheets are the final record.", undefined, true);
  const cash = r.methods.find((m) => m.name === "Cash");
  const check = r.methods.find((m) => m.name === "Check");
  const owner = (who: string) => <span className="co-pill co-owner">{who}</span>;
  const steps: { title: string; sub: ReactNode; who: string; note: ReactNode }[] = [
    { title: "Collect every outstanding payment", sub: "Everything in sections 3 and 4: unpaid checkouts, post-checkout wins and proxy winnings.", who: "Treasurer",
      note: <InApp>Each one is recorded as a checkout on the <Path>Checkout</Path> page. The Dashboard's "Still Need to Check Out" list should be empty.</InApp> },
    { title: "Count the cash and checks and compare them with the app",
      sub: `The app shows cash ${usd2(cash?.amount ?? 0)} from ${cash?.count ?? 0} bidder${cash?.count === 1 ? "" : "s"}, checks ${usd2(check?.amount ?? 0)} from ${check?.count ?? 0}.`, who: "Treasurer",
      note: <InApp>If a count differs, find that checkout in <Path>Settings → Action History</Path> and correct its payment method or amount.</InApp> },
    { title: "Deposit the cash and checks", sub: "Keep the deposit slip with the auction records.", who: "Treasurer", note: <OfflineOnly /> },
    { title: "Confirm every card payment has cleared in PayPal", sub: "Check pavetheway@orns.org's account for held or unpaid invoices.", who: "Admin",
      note: <InApp>The <Path>PayPal Sweeper Status</Path> card shows nothing still waiting. A bidder who paid another way is marked paid with Cash or Check.</InApp> },
    { title: "Print all receipts", sub: "25 bidders per file, alphabetical, saved to the Receipts folder.", who: "Admin",
      note: <InApp><Path>Checkout → Print All Receipts</Path>. If it stops partway, the message says which parts were printed.</InApp> },
    { title: "Email receipts to every bidder with an email address", sub: "Email Receipt is turned off for bidders without a valid address.", who: "Admin",
      note: <InApp>Fix a missing address in the <Path>Bidders</Path> tab first, then use <Path>Email Receipt</Path> on the Checkout page.</InApp> },
    { title: "Return or re-home the unsold items",
      sub: r.unsold.length ? r.unsold.map((u) => `${u.id} · ${u.name}`).join("  ·  ") : "Every item had a winning bid.", who: "Committee",
      note: <InApp>Update each item on the <Path>Auction Items</Path> page so the archive shows what happened to it.</InApp> },
    { title: "Send thank-you letters to donors and sponsors", sub: "Include the total raised once payments are in.", who: "Committee", note: <OfflineOnly /> },
    { title: "Work through bug reports filed on auction night", sub: "Filed with the bug button or Ctrl/Cmd-Shift-B.", who: "Admin",
      note: <InApp><Path>Settings → Bug Reports</Path>: View each one, then Resolve it once it's fixed.</InApp> },
    { title: "Pause the PayPal sweeper job", sub: "It only needs to run during the auction.", who: "Developer",
      note: <OutsideApp>Google Cloud console → Cloud Scheduler → pause the PayPal sweeper job.</OutsideApp> },
    { title: "Let the app sleep again", sub: "Undo auction week's keep-awake setting.", who: "Developer",
      note: <OutsideApp><span className="co-num">gcloud run services update orns-auction-manager-gh --region=us-east1 --min-instances=0</span></OutsideApp> },
    { title: "Archive the auction (do this last)", sub: "Closing does not archive. Archiving again later replaces the earlier copies.", who: "Admin",
      note: <InApp><Path>Settings → Archive This Auction</Path>, year {year}. It copies the Tickets, Items and Bid Management spreadsheets to the "{year} Auction" folder.</InApp> },
  ];
  steps.forEach((s, i) => add(`step-${i + 1}`, (
    <Task title={<><span className="co-step">{i + 1}</span>{s.title}</>} sub={s.sub} right={owner(s.who)} note={s.note} />
  )));
  add("signoff", (
    <div className="co-signoff">
      {["Director", "Auction chair", "Application administrator", "Date closed out"].map((label) => (
        <div key={label}><div className="co-line" /><span>{label}</span></div>
      ))}
    </div>
  ));
  return blocks;
}
