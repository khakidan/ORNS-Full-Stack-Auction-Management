/**
 * @vitest-environment jsdom
 *
 * WinnerCard's "Checkout" button had a permanently-dead loading condition
 * (refactor-opportunities.md): `loading={processingId === \`${bidderId}-pay\`}`,
 * but useCheckoutState.ts never writes a `-pay` suffix to `processingId`
 * anywhere - confirmed by grep before this fix. Rewired to a real
 * `payingBidderId` prop (Checkout.tsx now derives it from
 * `isSubmittingPayment`/`winnerToPay`, the flags PaymentMethodDialog's own
 * spinner already uses) so this button reflects the real in-flight window:
 * confirmMarkPaid closes the dialog immediately but keeps
 * isSubmittingPayment/winnerToPay set until its background sync settles.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom";
import { WinnerCard } from "./WinnerCard";
import { WinnerRecord } from "@/hooks/useCheckoutState";

const WINNER: WinnerRecord = {
  bidderId: "101",
  name: "Alice One",
  total: 50,
  items: [{ id: "item1", name: "Art Class", price: 50 }],
  paid: false,
  paymentPending: false,
};

function renderCard(overrides: Partial<React.ComponentProps<typeof WinnerCard>> = {}) {
  return render(
    <WinnerCard
      winner={WINNER}
      hasEmail={true}
      processingId={null}
      payingBidderId={null}
      onEmailReceipt={vi.fn()}
      onPrintReceipt={vi.fn()}
      onMarkPaid={vi.fn()}
      {...overrides}
    />
  );
}

describe("WinnerCard", () => {
  it("does not show the Checkout button as loading when nothing is paying", () => {
    renderCard();
    const button = screen.getByRole("button", { name: "Checkout" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("shows the Checkout button as loading/disabled when this winner is the one being paid", () => {
    renderCard({ payingBidderId: "101" });
    const button = screen.getByRole("button", { name: "Processing..." }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("does not show this winner's Checkout button as loading when a different winner is being paid", () => {
    renderCard({ payingBidderId: "102" });
    const button = screen.getByRole("button", { name: "Checkout" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("no longer shows the loading spinner for a `-pay`-suffixed processingId - that write path never existed in useCheckoutState.ts", () => {
    // isProcessingThisWinner (any processingId prefixed with this bidder's
    // id) legitimately still disables the button - that part is real,
    // unrelated cross-action locking. What's under test here is narrower:
    // the button must render its idle "Checkout" label, not the
    // loading-only "Processing..." one, since nothing ever actually
    // writes a `-pay` suffix to processingId.
    renderCard({ processingId: "101-pay" });
    expect(screen.getByRole("button", { name: "Checkout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Processing..." })).not.toBeInTheDocument();
  });

  it("shows the 'Awaiting checkout' status chip for a winner who hasn't started checkout", () => {
    renderCard();
    expect(screen.getByText("Awaiting checkout")).toBeInTheDocument();
  });

  it("shows the 'Pending verification' status chip for a winner mid-PayPal-verification", () => {
    renderCard({ winner: { ...WINNER, paymentPending: true } });
    expect(screen.getByText("Pending verification")).toBeInTheDocument();
  });

  it("shows the 'Paid' status chip, plus the payment method line when one is on file", () => {
    renderCard({ winner: { ...WINNER, paid: true, paymentMethod: "Cash" } });
    // The chip and the footer both render the word "Paid" - assert there are two, and the method line separately.
    expect(screen.getAllByText("Paid").length).toBe(2);
    expect(screen.getByText("via Cash")).toBeInTheDocument();
  });

  it("does not show a payment method line when a paid winner has no method on file", () => {
    renderCard({ winner: { ...WINNER, paid: true, paymentMethod: "" } });
    expect(screen.queryByText(/^via /)).not.toBeInTheDocument();
  });

  it("labels the disabled Email button 'No Email' instead of only relying on a hover title", () => {
    renderCard({ hasEmail: false });
    expect(screen.getByRole("button", { name: "No Email" })).toBeInTheDocument();
  });

  it("shows initials derived from the winner's full name in the avatar", () => {
    renderCard({ winner: { ...WINNER, name: "Alice One" } });
    expect(screen.getByText("AO")).toBeInTheDocument();
  });
});
