/**
 * __tests__/dashboard-charts.test.tsx
 *
 * The dashboard's recharts widgets moved out of `pages/dashboard.tsx` into
 * `@/components/DashboardCharts` so the charting library is no longer part of
 * the page's initial bundle (#1442). These tests pin the behaviour the page
 * depends on after that move: the loading skeletons, the series wiring, and the
 * bar-click → selected-month callback (re-expressed through recharts'
 * `activeTooltipIndex` instead of the removed `activePayload` access).
 *
 * recharts is stubbed because its ResponsiveContainer needs real element
 * measurements, which jsdom does not provide.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  BalanceHistoryChart,
  MonthlySpendingChart,
  ThirtyDayVolumeChart,
  type MonthlySpendingPoint,
} from "@/components/DashboardCharts";

jest.mock("recharts", () => {
  const React = require("react");

  const container = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  );

  const chart = (name: string) =>
    ({
      data,
      onClick,
      children,
    }: {
      data?: unknown[];
      onClick?: (state: { activeTooltipIndex: number }) => void;
      children?: React.ReactNode;
    }) => (
      <div data-testid={name} data-rows={data?.length ?? 0}>
        <button
          type="button"
          data-testid={`${name}-activate`}
          onClick={() => onClick?.({ activeTooltipIndex: 1 })}
        />
        {children}
      </div>
    );

  return {
    ResponsiveContainer: container,
    BarChart: chart("bar-chart"),
    LineChart: chart("line-chart"),
    Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
    Line: () => <div data-testid="line-series" />,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
  };
});

const MONTHS: MonthlySpendingPoint[] = [
  { month: "Aug", monthIndex: 7, year: 2026, label: "August 2026", sent: 10, received: 4 },
  { month: "Sep", monthIndex: 8, year: 2026, label: "September 2026", sent: 25, received: 9 },
  { month: "Oct", monthIndex: 9, year: 2026, label: "October 2026", sent: 31, received: 2 },
];

const DAYS = [
  { day: "01 Oct", dateKey: "2026-9-1", sent: 1, received: 0 },
  { day: "02 Oct", dateKey: "2026-9-2", sent: 0, received: 5 },
];

describe("DashboardCharts (lazy-loaded by the dashboard)", () => {
  it("renders a skeleton instead of the chart while the first fetch is pending", () => {
    const { container } = render(
      <MonthlySpendingChart data={[]} loading onBarClick={jest.fn()} />
    );

    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("renders the spending series once data arrives", () => {
    render(<MonthlySpendingChart data={MONTHS} loading={false} onBarClick={jest.fn()} />);

    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-rows", "3");
    expect(screen.getByTestId("bar-sent")).toBeInTheDocument();
    expect(screen.getByText("Monthly Spending (XLM)")).toBeInTheDocument();
  });

  it("selects the month whose bar was clicked", () => {
    const onBarClick = jest.fn();
    render(<MonthlySpendingChart data={MONTHS} loading={false} onBarClick={onBarClick} />);

    fireEvent.click(screen.getByTestId("bar-chart-activate"));

    expect(onBarClick).toHaveBeenCalledWith(MONTHS[1]);
  });

  it("ignores a click that resolves to no data point", () => {
    const onBarClick = jest.fn();
    render(
      <MonthlySpendingChart data={MONTHS.slice(0, 1)} loading={false} onBarClick={onBarClick} />
    );

    fireEvent.click(screen.getByTestId("bar-chart-activate"));

    expect(onBarClick).not.toHaveBeenCalled();
  });

  it("renders both volume series for the 30-day chart", () => {
    render(<ThirtyDayVolumeChart data={DAYS} loading={false} />);

    expect(screen.getByTestId("bar-sent")).toBeInTheDocument();
    expect(screen.getByTestId("bar-received")).toBeInTheDocument();
  });

  it("shows the empty state when the balance history has no points to plot", () => {
    render(<BalanceHistoryChart data={[]} loading={false} />);

    expect(screen.getByText("Insufficient history")).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("plots the balance line when there is history", () => {
    render(
      <BalanceHistoryChart
        data={[
          { date: "01 Oct", balance: 100, timestamp: 1 },
          { date: "02 Oct", balance: 120, timestamp: 2 },
        ]}
        loading={false}
      />
    );

    expect(screen.getByTestId("line-chart")).toHaveAttribute("data-rows", "2");
    expect(screen.getByTestId("line-series")).toBeInTheDocument();
  });
});
