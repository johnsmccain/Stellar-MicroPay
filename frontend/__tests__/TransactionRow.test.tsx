import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TransactionRow, TransactionRowProps, areEqual } from "@/components/TransactionRow";
import type { PaymentRecord } from "@/lib/stellar";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), query: {} }),
}));

function makePayment(id: string, overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id,
    type: "sent",
    amount: "10.0000000",
    asset: "XLM",
    from: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYGJ2DN5ZKQYTROZXNUAAOXWS7",
    to: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
    createdAt: "2026-01-01T00:00:00.000Z",
    transactionHash: `hash-${id}`,
    pagingToken: `token-${id}`,
    ...overrides,
  };
}

describe("TransactionRow memoization (Issue #1150)", () => {
  it("areEqual comparator returns true for identical data even with new callback references", () => {
    const p1 = makePayment("1", { amount: "10" });
    const propsA: TransactionRowProps = {
      tx: p1,
      index: 0,
      focusedIndex: -1,
      visibleCount: 1,
      publicKey: "GABC...",
      isCopied: false,
      note: undefined,
      isEditingNote: false,
      noteInputValue: "",
      mintingReceiptHash: null,
      mintedReceiptHashes: {},
      onCopy: async () => {},
      onRepeatPayment: () => {},
      onFocus: () => {},
      onBlur: () => {},
      onKeyDown: () => {},
      onStartEditNote: () => {},
      onSaveNote: () => {},
      onCancelEditNote: () => {},
      onNoteInputChange: () => {},
    };

    const propsB: TransactionRowProps = {
      ...propsA,
      onCopy: async () => {}, // new callback reference
      onRepeatPayment: () => {},
    };

    expect(areEqual(propsA, propsB)).toBe(true);

    // Any visible data change returns false
    expect(areEqual(propsA, { ...propsA, tx: { ...p1, amount: "20" } })).toBe(false);
    expect(areEqual(propsA, { ...propsA, note: "my note" })).toBe(false);
    expect(areEqual(propsA, { ...propsA, isCopied: true })).toBe(false);
    expect(areEqual(propsA, { ...propsA, isEditingNote: true })).toBe(false);
  });

  it("render count spy proves: parent re-render does not re-render rows, and changing one payment re-renders only that row", () => {
    const rowRenderSpy = jest.fn();

    const MemoRow = React.memo((props: TransactionRowProps) => {
      rowRenderSpy(props.tx.id);
      return <TransactionRow {...props} />;
    }, areEqual);

    function TestHarness() {
      const [payments, setPayments] = useState<PaymentRecord[]>([
        makePayment("tx-1", { amount: "10" }),
        makePayment("tx-2", { amount: "20" }),
      ]);
      const [parentTick, setParentTick] = useState(0);

      const noop = () => {};
      const asyncNoop = async () => {};

      return (
        <div>
          <button data-testid="bump-parent" onClick={() => setParentTick((t) => t + 1)}>
            Tick: {parentTick}
          </button>
          <button
            data-testid="update-tx-1"
            onClick={() =>
              setPayments((prev) => [
                { ...prev[0], amount: "15" },
                prev[1],
              ])
            }
          >
            Update Tx 1
          </button>
          {payments.map((tx, idx) => (
            <MemoRow
              key={tx.id}
              tx={tx}
              index={idx}
              focusedIndex={-1}
              visibleCount={2}
              publicKey="GABC..."
              isCopied={false}
              note={undefined}
              isEditingNote={false}
              noteInputValue=""
              mintingReceiptHash={null}
              mintedReceiptHashes={{}}
              onCopy={asyncNoop}
              onRepeatPayment={noop}
              onFocus={noop}
              onBlur={noop}
              onKeyDown={noop}
              onStartEditNote={noop}
              onSaveNote={noop}
              onCancelEditNote={noop}
              onNoteInputChange={noop}
            />
          ))}
        </div>
      );
    }

    render(<TestHarness />);

    // 1. Initial mount: each row renders once
    expect(rowRenderSpy).toHaveBeenCalledTimes(2);
    expect(rowRenderSpy).toHaveBeenNthCalledWith(1, "tx-1");
    expect(rowRenderSpy).toHaveBeenNthCalledWith(2, "tx-2");

    // 2. Parent re-renders with unchanged data: rows MUST NOT re-render
    fireEvent.click(screen.getByTestId("bump-parent"));
    expect(screen.getByText("Tick: 1")).toBeInTheDocument();
    expect(rowRenderSpy).toHaveBeenCalledTimes(2); // Still 2!

    // 3. Update tx-1: ONLY tx-1 re-renders, tx-2 does NOT re-render
    fireEvent.click(screen.getByTestId("update-tx-1"));
    expect(rowRenderSpy).toHaveBeenCalledTimes(3); // 2 + 1 = 3
    expect(rowRenderSpy).toHaveBeenNthCalledWith(3, "tx-1");
  });
});
