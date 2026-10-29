/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import TicketPricingCard from "./TicketPricingCard";
import { Config } from "@/types";

function Harness({ initial }: { initial: Partial<Config> }) {
  const [config, setConfig] = useState({ ticketPrice: "30", ticketPriceFromWebsiteAt: "", ...initial } as Config);
  return <TicketPricingCard config={config} setConfig={setConfig} />;
}

describe("TicketPricingCard", () => {
  it("is editable until Set Up has taken the price from the website", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{}} />);
    const price = screen.getByLabelText("Walk-In Ticket Price ($)");

    await user.clear(price);
    await user.type(price, "40");

    expect(price).toHaveValue(40);
    expect(screen.queryByText(/From the website's ticket form/)).not.toBeInTheDocument();
  });

  it("shows the website's price read-only afterwards, and says how to change it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ticketPrice: "35", ticketPriceFromWebsiteAt: "2027-03-01T15:00:00.000Z" }} />);
    const price = screen.getByLabelText("Walk-In Ticket Price ($)");

    await user.type(price, "9");

    expect(price).toHaveValue(35);
    expect(price).toHaveAccessibleDescription(/From the website's ticket form, checked Mar 1, 2027\. To change it, change the price on the form and run Set Up Bid Management App again\./);
  });
});
