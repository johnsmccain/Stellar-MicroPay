import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MonthlySpendingChart,
  ThirtyDayVolumeChart,
  BalanceHistoryChart,
} from "@/components/DashboardCharts";

// Mock recharts ResponsiveContainer so it renders children in jsdom
jest.mock("recharts", () => {
  const Original = jest.requireActual("recharts");
  return {
    ...Original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 500, height: 300 }}>
        {children}
      </div>
    ),
  };
});

describe("DashboardCharts (Issue #1152)", () => {
  describe("MonthlySpendingChart", () => {
    it("renders loading state with pulse placeholder when loading and no data", () => {
      const { container } = render(
        <MonthlySpendingChart data={[]} loading={true} onBarClick={jest.fn()} />
      );
      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    it("renders chart when data is provided", () => {
      render(
        <MonthlySpendingChart
          data={[{ month: "Jan", sent: 100, received: 50 }]}
          loading={false}
          onBarClick={jest.fn()}
        />
      );
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  describe("ThirtyDayVolumeChart", () => {
    it("renders loading state when loading and empty", () => {
      const { container } = render(<ThirtyDayVolumeChart data={[]} loading={true} />);
      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    it("renders chart container when data exists", () => {
      render(
        <ThirtyDayVolumeChart
          data={[{ day: "01/01", sent: 10, received: 5 }]}
          loading={false}
        />
      );
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  describe("BalanceHistoryChart", () => {
    it("renders insufficient history warning when data points < 2", () => {
      render(
        <BalanceHistoryChart
          data={[{ date: "Jan 1", balance: 100, timestamp: 1000 }]}
          loading={false}
        />
      );
      expect(screen.getByText("Insufficient history")).toBeInTheDocument();
    });

    it("renders chart when at least 2 data points exist", () => {
      render(
        <BalanceHistoryChart
          data={[
            { date: "Jan 1", balance: 100, timestamp: 1000 },
            { date: "Jan 2", balance: 120, timestamp: 2000 },
          ]}
          loading={false}
        />
      );
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });
});
