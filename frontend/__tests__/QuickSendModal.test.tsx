import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import QuickSendModal from "@/components/QuickSendModal";

jest.mock("@/components/SendPaymentForm", () => {
  return function MockSendPaymentForm({ onSuccess }: { onSuccess?: () => void }) {
    return (
      <form data-testid="mock-send-payment-form">
        <input data-testid="send-dest-input" placeholder="Destination" />
        <input data-testid="send-amount-input" placeholder="Amount" />
        <button type="button" onClick={onSuccess}>
          Submit Payment
        </button>
      </form>
    );
  };
});

describe("QuickSendModal", () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    publicKey: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
    xlmBalance: "100.0000000",
    usdcBalance: "50.0000000",
  };

  it("renders nothing when isOpen is false", () => {
    render(<QuickSendModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog with role='dialog', aria-modal='true', and accessible name", () => {
    render(<QuickSendModal {...defaultProps} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Quick send payment");
  });

  it("moves focus into the dialog on open", async () => {
    jest.useFakeTimers();
    render(<QuickSendModal {...defaultProps} />);

    act(() => {
      jest.runAllTimers();
    });

    const closeBtn = screen.getByRole("button", { name: /close quick send/i });
    expect(closeBtn).toHaveFocus();
    jest.useRealTimers();
  });

  it("closes on Escape key press", () => {
    const onClose = jest.fn();
    render(<QuickSendModal {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab key navigation by cycling through focusable elements", async () => {
    jest.useFakeTimers();
    render(<QuickSendModal {...defaultProps} />);

    act(() => {
      jest.runAllTimers();
    });

    const focusableButtons = screen.getAllByRole("button");
    const closeBtn = focusableButtons[0];
    const submitBtn = focusableButtons[focusableButtons.length - 1];

    // Focus last focusable element and press Tab -> should wrap to first element
    submitBtn.focus();
    expect(submitBtn).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeBtn).toHaveFocus();

    // Focus first element and press Shift+Tab -> should wrap to last element
    closeBtn.focus();
    expect(closeBtn).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(submitBtn).toHaveFocus();

    jest.useRealTimers();
  });

  it("restores focus to the triggering element when modal closes", async () => {
    function Wrapper() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button data-testid="open-quick-send-btn" onClick={() => setIsOpen(true)}>
            Open Quick Send
          </button>
          <QuickSendModal
            {...defaultProps}
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
          />
        </div>
      );
    }

    const { getByTestId, queryByRole, getByRole } = render(<Wrapper />);
    const trigger = getByTestId("open-quick-send-btn");
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });
});
