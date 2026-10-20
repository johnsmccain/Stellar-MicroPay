import React, { useState } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { useModalFocusTrap } from "@/hooks/useModalFocusTrap";

function TestModal({
  isOpen,
  onClose,
  hasInteractive = true,
  autoFocusInput = false,
}: {
  isOpen: boolean;
  onClose?: () => void;
  hasInteractive?: boolean;
  autoFocusInput?: boolean;
}) {
  const containerRef = useModalFocusTrap<HTMLDivElement>({ isOpen, onClose });

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      data-testid="test-dialog"
    >
      {hasInteractive ? (
        <>
          <button data-testid="first-btn">First Button</button>
          {autoFocusInput ? (
            <input data-testid="autofocus-input" autoFocus />
          ) : (
            <input data-testid="middle-input" />
          )}
          <button data-testid="last-btn">Last Button</button>
        </>
      ) : (
        <p>No interactive elements</p>
      )}
    </div>
  );
}

function TestHarness() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button data-testid="trigger-btn" onClick={() => setIsOpen(true)}>
        Open Modal
      </button>
      <TestModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  );
}

describe("useModalFocusTrap", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("moves focus to the first focusable element when modal opens", async () => {
    render(<TestModal isOpen={true} />);

    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByTestId("first-btn")).toHaveFocus();
  });

  it("focuses container if no interactive elements exist inside", async () => {
    render(<TestModal isOpen={true} hasInteractive={false} />);

    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByTestId("test-dialog")).toHaveFocus();
  });

  it("preserves autoFocus on an element inside the dialog", async () => {
    render(<TestModal isOpen={true} autoFocusInput={true} />);

    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByTestId("autofocus-input")).toHaveFocus();
  });

  it("traps Tab key navigation by cycling from last element to first", async () => {
    render(<TestModal isOpen={true} />);

    act(() => {
      jest.runAllTimers();
    });

    const firstBtn = screen.getByTestId("first-btn");
    const lastBtn = screen.getByTestId("last-btn");

    lastBtn.focus();
    expect(lastBtn).toHaveFocus();

    // Tab on last element should wrap to first element
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    window.dispatchEvent(event);

    expect(firstBtn).toHaveFocus();
  });

  it("traps Shift+Tab key navigation by cycling from first element to last", async () => {
    render(<TestModal isOpen={true} />);

    act(() => {
      jest.runAllTimers();
    });

    const firstBtn = screen.getByTestId("first-btn");
    const lastBtn = screen.getByTestId("last-btn");

    firstBtn.focus();
    expect(firstBtn).toHaveFocus();

    // Shift+Tab on first element should wrap to last element
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(lastBtn).toHaveFocus();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = jest.fn();
    render(<TestModal isOpen={true} onClose={onClose} />);

    act(() => {
      jest.runAllTimers();
    });

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    window.dispatchEvent(event);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to trigger element when modal closes", async () => {
    jest.useRealTimers();
    const user = userEvent.setup();

    render(<TestHarness />);

    const triggerBtn = screen.getByTestId("trigger-btn");
    await user.click(triggerBtn);

    expect(screen.getByTestId("test-dialog")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("first-btn")).toHaveFocus();
    });

    // Press Escape to close
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByTestId("test-dialog")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(triggerBtn).toHaveFocus();
    });
  });
});
