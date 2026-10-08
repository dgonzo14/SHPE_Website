import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test/renderWithProviders";
import type { CardInsights } from "@/types/database";
import { formatDayLong, formatDayShort, formatWeekday, plural } from "../format";
import { InsightsTab } from "../InsightsTab";

const fetchMyCardInsights = vi.hoisted(() => vi.fn<(days: number) => Promise<CardInsights>>());
vi.mock("@/services/cards", () => ({ fetchMyCardInsights }));

function daysEnding(last: string, count: number, views: (index: number) => number): CardInsights["daily"] {
  const end = new Date(`${last}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (count - 1 - i));
    return { day: date.toISOString().slice(0, 10), views: views(i), saves: 0, shares: 0 };
  });
}

function insights(days: number, overrides: Partial<CardInsights> = {}): CardInsights {
  return {
    days,
    totals: days === 7
      ? { views: 9, saves: 2, shares: 1, nfc: 5, qr: 3, link: 1 }
      : { views: 41, saves: 7, shares: 4, nfc: 20, qr: 12, link: 9 },
    daily: daysEnding("2026-10-06", days, (i) => (i === days - 2 ? 6 : i % 3)),
    links: [
      { link_id: "l1", kind: "linkedin", label: null, clicks: 12 },
      { link_id: "l2", kind: "custom", label: "Book a coffee chat", clicks: 0 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  fetchMyCardInsights.mockImplementation(async (days) => insights(days));
});

describe("InsightsTab", () => {
  it("shows an empty state before there is a card, without fetching", () => {
    renderWithProviders(<InsightsTab hasCard={false} />, { route: "/portal/card" });
    expect(screen.getByText("No insights yet")).toBeInTheDocument();
    expect(fetchMyCardInsights).not.toHaveBeenCalled();
  });

  it("renders the 30-day totals, the daily chart and clicks per link", async () => {
    renderWithProviders(<InsightsTab hasCard />, { route: "/portal/card" });

    expect(await screen.findByText("41")).toBeInTheDocument();
    expect(fetchMyCardInsights).toHaveBeenCalledWith(30);
    for (const [label, value] of [
      ["Views", "41"],
      ["NFC taps", "20"],
      ["QR scans", "12"],
      ["Shared-link visits", "9"],
      ["Contact saves", "7"],
      ["Shares", "4"],
    ]) {
      const card = screen.getByText(label, { selector: "p" }).parentElement as HTMLElement;
      expect(within(card).getByText(value)).toBeInTheDocument();
    }

    const chart = screen.getByRole("figure", { name: "Views per day" });
    expect(within(chart).getAllByTestId("day-bar")).toHaveLength(30);
    expect(chart).toHaveAccessibleDescription(/Busiest day: Monday, October 5, with 6 views\./);

    const table = screen.getByRole("table", { name: "Clicks per link, last 30 days" });
    expect(within(table).getByText("LinkedIn")).toBeInTheDocument();
    expect(within(table).getByText("Book a coffee chat")).toBeInTheDocument();
    expect(within(table).getByText("12")).toBeInTheDocument();
    // How views are counted: once per browser every 30 minutes, not per session.
    const note = screen.getByText(/your own visits aren't counted/);
    expect(note).toHaveTextContent(/at most once every 30 minutes for each browser/);
    expect(note).not.toHaveTextContent(/session/);
  });

  it("switches to the last 7 days", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InsightsTab hasCard />, { route: "/portal/card" });
    await screen.findByText("41");
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Last 7 days" }));

    expect(fetchMyCardInsights).toHaveBeenLastCalledWith(7);
    expect(await screen.findByText("9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last 7 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Your card's last 7 days" })).toBeInTheDocument();
    const chart = screen.getByRole("figure", { name: "Views per day" });
    await waitFor(() => expect(within(chart).getAllByTestId("day-bar")).toHaveLength(7));
    // A week gets a weekday under every column.
    expect(within(chart).getByText("Tue")).toBeInTheDocument();
  });

  it("keeps the daily numbers in a table anyone can open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InsightsTab hasCard />, { route: "/portal/card" });
    await screen.findByText("41");

    await user.click(screen.getByText("Show daily numbers"));
    const table = screen.getByRole("table", { name: "Views per day, last 30 days" });
    expect(within(table).getAllByRole("row")).toHaveLength(31);
    expect(within(table).getByText("Tuesday, October 6")).toBeInTheDocument();
  });

  it("says so when nobody has viewed the card yet", async () => {
    fetchMyCardInsights.mockResolvedValue(
      insights(30, {
        totals: { views: 0, saves: 0, shares: 0, nfc: 0, qr: 0, link: 0 },
        daily: daysEnding("2026-10-06", 30, () => 0),
        links: [],
      }),
    );
    renderWithProviders(<InsightsTab hasCard />, { route: "/portal/card" });

    expect(await screen.findByText(/No views in the last 30 days yet\. Share your link/)).toBeInTheDocument();
    expect(screen.queryAllByTestId("day-bar")).toHaveLength(0);
    expect(screen.getByText(/Your card has no links yet/)).toBeInTheDocument();
  });

  it("shows an error with a retry", async () => {
    const user = userEvent.setup();
    fetchMyCardInsights.mockRejectedValueOnce(new Error("network down"));
    renderWithProviders(<InsightsTab hasCard />, { route: "/portal/card" });

    expect(await screen.findByText("We couldn't load your insights")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("41")).toBeInTheDocument();
  });
});

describe("insights date formatting", () => {
  it("reads plain dates as calendar days, whatever the timezone", () => {
    expect(formatDayShort("2026-10-06")).toBe("Oct 6");
    expect(formatWeekday("2026-10-06")).toBe("Tue");
    expect(formatDayLong("2026-01-01")).toBe("Thursday, January 1");
    expect(formatDayShort("not a date")).toBe("not a date");
  });

  it("pluralises counts", () => {
    expect(plural(1, "view")).toBe("1 view");
    expect(plural(0, "view")).toBe("0 views");
    expect(plural(1200, "view")).toBe("1,200 views");
  });
});
