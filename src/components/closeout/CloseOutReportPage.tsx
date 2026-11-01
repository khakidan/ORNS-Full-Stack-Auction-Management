import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/geist-mono";
import "./closeOutReport.css";
import { Button } from "@/components/ui/button";
import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { getSheetData } from "@/services/google-api";
import { buildCloseOutReport } from "@/lib/closeOutReport";
import { paginateReport, type ReportPage } from "@/lib/reportPagination";
import { buildCloseOutBlocks, ContinuedTitle, type ReportBlock } from "./closeOutBlocks";

/** A US Letter sheet at 96 px per inch - the on-screen fit-to-width scale is worked out from it. */
const SHEET_WIDTH_PX = 816;

interface SheetExtras {
  /** The Follow-Up sheet's rows below the header. */
  followUpRows: string[][];
  giftCardWinnerId: string;
  raffleWinnerId: string;
}

/** The Follow-Up and Special-Winners reads the Dashboard also makes (useDashboardState.ts). A missing tab reads as empty. */
function useSheetExtras(spreadsheetId: string, dataVersion: number) {
  const [extras, setExtras] = useState<SheetExtras | null>(null);
  useEffect(() => {
    if (!spreadsheetId) return;
    let cancelled = false;
    const read = (range: string) => getSheetData(spreadsheetId, range).then((d) => (d.values ?? []) as string[][]).catch(() => [] as string[][]);
    Promise.all([read("Follow-Up!A:C"), read("Special-Winners!A2:B3")]).then(([followUp, special]) => {
      if (cancelled) return;
      setExtras({
        followUpRows: followUp.slice(1),
        giftCardWinnerId: String(special[0]?.[1] ?? ""),
        raffleWinnerId: String(special[1]?.[1] ?? ""),
      });
    });
    return () => { cancelled = true; };
  }, [spreadsheetId, dataVersion]);
  return extras;
}

function RunHead({ year }: { year: number }) {
  return <div className="co-run co-eyebrow"><span>ORNS · Auction Close-Out</span><span>{year} Auction</span></div>;
}

function Foot({ year, printedOn, page, total }: { year: number; printedOn: string; page: number; total: number }) {
  return (
    <div className="co-foot">
      <span>ORNS Auction Close-Out · {year} Auction · Printed {printedOn}</span>
      <span>Page {page} of {total}</span>
    </div>
  );
}

/**
 * Lays the blocks out on fixed-size sheets. Every block is first rendered
 * off-screen at the sheet's width and measured, then split into pages by
 * paginateReport. Re-measures when fonts arrive or the data changes, never
 * while printing. Until it has measured (or where nothing has a size, as
 * in tests) everything shows on one sheet.
 */
function PagedReport({ blocks, year, printedOn }: { blocks: ReportBlock[]; year: number; printedOn: string }) {
  const measureRef = useRef<HTMLDivElement>(null);
  const firstSlotRef = useRef<HTMLDivElement>(null);
  const contSlotRef = useRef<HTMLDivElement>(null);
  const contTitleRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<ReportPage[] | null>(null);

  const measure = useCallback(() => {
    if (window.matchMedia?.("print").matches) return;
    const box = measureRef.current;
    const firstCapacity = firstSlotRef.current?.clientHeight ?? 0;
    const contCapacity = contSlotRef.current?.clientHeight ?? 0;
    if (!box || !firstCapacity || !contCapacity) return;
    const heights = [...box.querySelectorAll<HTMLElement>("[data-flow-block]")].map((el) => el.getBoundingClientRect().height);
    const next = paginateReport(
      blocks.map((b, i) => ({ height: heights[i] ?? 0, section: b.section, isSectionHead: b.isSectionHead, keepWithNext: b.keepWithNext, breakBefore: b.breakBefore })),
      { firstCapacity, contCapacity, continuedHeight: contTitleRef.current?.getBoundingClientRect().height ?? 0 },
    );
    setPages((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [blocks]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    document.fonts?.ready.then(() => measure()).catch(() => {});
    const box = measureRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);

  const laidOut = pages ?? [{ blocks: blocks.map((_, i) => i), continues: null }];
  const sectionNo = (title: string) => blocks.find((b) => b.section === title)?.sectionNo ?? "";

  return (
    <>
      <div className="co-measure" aria-hidden="true">
        <section className="co-sheet"><div className="co-slot" ref={firstSlotRef} /><Foot year={year} printedOn={printedOn} page={1} total={1} /></section>
        <section className="co-sheet"><RunHead year={year} /><div className="co-slot" ref={contSlotRef} /><Foot year={year} printedOn={printedOn} page={1} total={1} /></section>
        <section className="co-sheet co-auto">
          <div className="co-slot" ref={measureRef}>
            <div ref={contTitleRef}><ContinuedTitle no="3" title="Post-auction follow-up" /></div>
            {blocks.map((b) => <div key={b.key} data-flow-block>{b.node}</div>)}
          </div>
        </section>
      </div>
      {laidOut.map((page, p) => (
        <div className="co-frame" key={p}>
          <section className="co-sheet" aria-label={`Page ${p + 1} of ${laidOut.length}`}>
            {p > 0 && <RunHead year={year} />}
            <div className="co-slot">
              {page.continues && <ContinuedTitle no={sectionNo(page.continues)} title={page.continues} />}
              {page.blocks.map((i) => <Fragment key={blocks[i]!.key}>{blocks[i]!.node}</Fragment>)}
            </div>
            <Foot year={year} printedOn={printedOn} page={p + 1} total={laidOut.length} />
          </section>
        </div>
      ))}
    </>
  );
}

/**
 * The printable close-out report, opened in its own tab from the
 * Dashboard's Post-Auction Follow-Up card. US Letter sheets of what the
 * Dashboard shows after Close, plus the money totals and the wrap-up
 * checklist with boxes to tick by hand. Printed, or saved as a PDF, from
 * the browser's print dialog.
 */
export default function CloseOutReportPage() {
  const { bidders, items, bidGridWins, winners, totalRaised, isAuctionClosed, loading, dataVersion } = useAuction();
  const { config } = useConfig();
  const extras = useSheetExtras(config.bidManagementSpreadsheetId, dataVersion);
  const [scale, setScale] = useState(1);
  const deskRef = useRef<HTMLDivElement>(null);

  const now = useMemo(() => new Date(), []);
  const year = now.getFullYear();
  const printedOn = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const printedAt = now.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  const ready = !loading && extras !== null && bidders.length > 0;
  const blocks = useMemo(() => {
    if (!ready || !extras) return [];
    const report = buildCloseOutReport({ bidders, items, wins: bidGridWins, winners, totalRaised, ...extras });
    return buildCloseOutBlocks(report, { year, printedAt, isAuctionClosed });
  }, [ready, extras, bidders, items, bidGridWins, winners, totalRaised, year, printedAt, isAuctionClosed]);

  // The browser offers this as the PDF's file name.
  useEffect(() => {
    const previous = document.title;
    document.title = `ORNS Auction Close-Out ${year}`;
    return () => { document.title = previous; };
  }, [year]);

  useLayoutEffect(() => {
    const desk = deskRef.current;
    if (!desk) return;
    const fit = () => {
      const cs = getComputedStyle(desk);
      const inner = desk.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (inner > 0) setScale(Math.min(1, inner / SHEET_WIDTH_PX));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(desk);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="co-root min-h-screen bg-slate-100" style={{ "--co-scale": scale } as CSSProperties}>
      <style>{"@page { size: letter; margin: 0; }"}</style>
      <header className="co-noprint sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center gap-3 px-4 py-3">
          <a href="/BidManagement" className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            <ArrowLeft className="w-4 h-4" /> Back to the Dashboard
          </a>
          <div className="mr-auto min-w-0">
            <p className="truncate text-sm font-semibold">Auction close-out report</p>
            <p className="text-xs text-muted-foreground">Print it, or choose Save as PDF in the print dialog. US Letter.</p>
          </div>
          <Button onClick={() => window.print()} disabled={!ready} className="gap-2" id="print-close-out-report">
            <Printer className="w-4 h-4" /> Print / Save as PDF
          </Button>
        </div>
        {ready && !isAuctionClosed && (
          <p className="mx-auto max-w-[900px] px-4 pb-3 text-xs text-amber-700">
            The auction isn't closed yet, so these figures can still change. The report is meant for after Close.
          </p>
        )}
      </header>
      <main ref={deskRef} className="co-desk mx-auto flex max-w-[900px] flex-col items-center gap-6 px-4 py-6">
        {!ready && <Loader2 className="w-6 h-6 animate-spin text-primary" aria-label="Loading the report" />}
        {ready && <PagedReport blocks={blocks} year={year} printedOn={printedOn} />}
      </main>
    </div>
  );
}
