/**
 * components/TransactionRow.tsx
 * Memoised single payment row extracted from TransactionList.
 *
 * React.memo comparator: re-renders only when the fields that can visibly
 * change for a given id change — id, type, amount, asset, memo,
 * createdAt, transactionHash, from, to, note, isEditing,
 * isCopied, isMinting, hasMintedReceipt, focusIndex.
 * Stable callback props (onCopy, onRepeat, etc.) are stabilised with
 * useCallback in the parent and excluded from the comparator intentionally,
 * so an unstable callback reference does not bust the memo.
 */

import React from "react";
import clsx from "clsx";
import { PaymentRecord } from "@/lib/stellar";
import { shortenAddress, explorerUrl } from "@/lib/stellar";
import { formatAsset, formatRelativeTime } from "@/utils/intlFormatters";
import { isReceiptEligible } from "@/lib/receipts";
import { useTranslation } from "@/contexts/I18nContext";

export interface TransactionRowProps {
  tx: PaymentRecord;
  index: number;
  focusedIndex: number;
  visibleCount: number;
  publicKey: string;
  isCopied: boolean;
  note: string | undefined;
  isEditingNote: boolean;
  noteInputValue: string;
  mintingReceiptHash: string | null;
  mintedReceiptHashes: Record<string, number>;

  // Stable callbacks — excluded from the memo comparator deliberately
  onCopy: (text: string, id: string) => Promise<void>;
  onRepeatPayment: (tx: PaymentRecord) => void;
  onFocus: (index: number) => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent, tx: PaymentRecord, index: number) => void;
  onStartEditNote: (hash: string) => void;
  onSaveNote: (hash: string) => void;
  onCancelEditNote: () => void;
  onNoteInputChange: (val: string) => void;
  onPrintReceipt?: (tx: PaymentRecord) => void;
  onMintReceipt?: (tx: PaymentRecord) => void;
}

function TransactionRowInner({
  tx,
  index,
  focusedIndex,
  visibleCount,
  publicKey,
  isCopied,
  note,
  isEditingNote,
  noteInputValue,
  mintingReceiptHash,
  mintedReceiptHashes,
  onCopy,
  onRepeatPayment,
  onFocus,
  onBlur,
  onKeyDown,
  onStartEditNote,
  onSaveNote,
  onCancelEditNote,
  onNoteInputChange,
  onPrintReceipt,
  onMintReceipt,
}: TransactionRowProps) {
  const { t } = useTranslation();
  const targetAddress = tx.type === "sent" ? tx.to : tx.from;
  const isFocused = focusedIndex === index;

  return (
    <div
      key={tx.id}
      tabIndex={isFocused ? 0 : -1}
      onKeyDown={(e) => onKeyDown(e, tx, index)}
      onBlur={onBlur}
      onFocus={() => onFocus(index)}
      className={clsx(
        "flex items-center gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/5 transition-colors group relative",
        isFocused && "outline-none ring-2 ring-stellar-500 ring-offset-2"
      )}
      aria-label={`${tx.type === "sent" ? t("transactionList.sent") : t("transactionList.received")} ${formatAsset(tx.amount, tx.asset)} ${tx.type === "sent" ? t("transactionList.to") : t("transactionList.from")} ${tx.type === "sent" ? tx.to : tx.from}`}
    >
      {/* Direction icon */}
      <div
        className={clsx(
          "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
          tx.type === "sent"
            ? "bg-red-500/10 border border-red-500/20"
            : "bg-emerald-500/10 border border-emerald-500/20"
        )}
      >
        {tx.type === "sent" ? (
          <ArrowUpIcon className="w-4 h-4 text-red-400" />
        ) : (
          <ArrowDownIcon className="w-4 h-4 text-emerald-400" />
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-200 capitalize">
            {tx.type === "sent" ? t("transactionList.sentTo") : t("transactionList.receivedFrom")}
          </span>
          <button
            type="button"
            onClick={() =>
              onCopy(
                tx.type === "sent" ? tx.to : tx.from,
                tx.id
              )
            }
            aria-label={tx.type === "sent" ? t("transactionList.copyRecipientAddress") : t("transactionList.copySenderAddress")}
            className="address-pill hover:border-stellar-500/40 transition-colors text-xs cursor-pointer"
          >
            {isCopied
              ? t("common.copied")
              : shortenAddress(tx.type === "sent" ? tx.to : tx.from, 5)}
          </button>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-slate-500">
            {formatRelativeTime(tx.createdAt)}
          </span>
          {tx.memo && (
            <span className="text-xs text-slate-600 truncate max-w-32">
              · &ldquo;{tx.memo}&rdquo;
            </span>
          )}
        </div>

        {/* Private note display (Issue #1189) */}
        {note && !isEditingNote && (
          <p className="text-xs italic text-slate-500 mt-0.5 truncate max-w-xs">
            📝 {note}
          </p>
        )}

        {/* Inline note editor */}
        {isEditingNote && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              type="text"
              value={noteInputValue}
              onChange={(e) => onNoteInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveNote(tx.transactionHash);
                if (e.key === "Escape") onCancelEditNote();
              }}
              placeholder={t("transactionList.notePlaceholder")}
              maxLength={200}
              autoFocus
              className="flex-1 text-xs bg-white/5 border border-white/10 rounded-md px-2 py-1 text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-stellar-500/40"
            />
            <button
              onClick={() => onSaveNote(tx.transactionHash)}
              className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded cursor-pointer"
            >
              {t("transactionList.save")}
            </button>
            <button
              onClick={onCancelEditNote}
              aria-label={t("transactionList.cancelEditNote")}
              className="text-xs text-slate-500 hover:text-slate-300 px-1 py-1 rounded cursor-pointer"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Amount + Repeat + Link */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className={clsx(
            "text-sm font-mono font-medium",
            tx.type === "sent" ? "text-red-400" : "text-emerald-400"
          )}
        >
          {tx.type === "sent" ? "-" : "+"}
          {formatAsset(tx.amount, tx.asset)}
        </span>

        {/* Add / edit private note button - Issue #1189 */}
        {!isEditingNote && (
          <button
            onClick={() => onStartEditNote(tx.transactionHash)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-slate-400 hover:text-stellar-400 px-1 py-0.5 rounded cursor-pointer"
            title={note ? t("transactionList.editNote") : t("transactionList.addNote")}
            aria-label={note ? t("transactionList.editNote") : t("transactionList.addNoteLabel")}
          >
            {note ? "✏️" : "📝"}
          </button>
        )}

        {/* Repeat Payment Button (#1187) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRepeatPayment(tx);
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-stellar-400 hover:text-stellar-300 bg-stellar-500/10 hover:bg-stellar-500/20 px-2 py-1 rounded transition-colors whitespace-nowrap cursor-pointer"
          title={t("transactionList.repeatTitle")}
          aria-label={t("transactionList.repeatPaymentTo", { address: shortenAddress(targetAddress, 4) })}
        >
          <RepeatIcon className="w-3 h-3" />
          {t("transactionList.repeat")}
        </button>

        {onPrintReceipt && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrintReceipt(tx);
            }}
            className="text-slate-500 hover:text-stellar-400 px-1 py-0.5 rounded transition-colors cursor-pointer"
            title={t("transactionList.printReceipt")}
            aria-label={t("transactionList.printReceiptFor", { hash: tx.transactionHash.slice(0, 8) })}
          >
            <PrinterIcon className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Mint on-chain receipt for eligible sent payments */}
        {onMintReceipt && isReceiptEligible(tx, publicKey) && (
          mintedReceiptHashes[tx.transactionHash] !== undefined ? (
            <span
              className="inline-flex items-center text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded whitespace-nowrap"
              data-testid={`receipt-minted-${tx.id}`}
            >
              {t("transactionList.receiptNumber", { index: mintedReceiptHashes[tx.transactionHash] })}
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMintReceipt(tx);
              }}
              disabled={mintingReceiptHash !== null}
              className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("transactionList.mintReceiptTitle")}
              aria-label={t("transactionList.mintReceiptFor", { address: shortenAddress(targetAddress, 4) })}
            >
              {mintingReceiptHash === tx.transactionHash ? t("transactionList.minting") : t("transactionList.mintReceipt")}
            </button>
          )
        )}

        <a
          href={explorerUrl(tx.transactionHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-stellar-400"
          title={t("transactionList.viewOnStellarExpert")}
          aria-label={t("transactionList.viewTxOnStellarExpert")}
        >
          <ExternalLinkIcon className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

/**
 * Compare two receipt-hash maps by value.
 *
 * The map is rebuilt (as a fresh object literal) on every parent render, so
 * comparing it by reference would defeat the memo comparator and re-render
 * every row on every parent update.
 */
function sameReceiptHashes(
  prev: Record<string, number>,
  next: Record<string, number>
): boolean {
  if (prev === next) return true;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  return prevKeys.every((key) => prev[key] === next[key]);
}

/**
 * Custom memo comparator.
 * Re-renders when any data field visible to the user changes.
 * Callback props are intentionally excluded — they are stabilised with
 * useCallback in the parent so they never change identity, but even if
 * they did, excluding them is the correct approach for memo on a list row.
 */
export function areEqual(prev: TransactionRowProps, next: TransactionRowProps): boolean {
  return (
    prev.tx.id === next.tx.id &&
    prev.tx.type === next.tx.type &&
    prev.tx.amount === next.tx.amount &&
    prev.tx.asset === next.tx.asset &&
    prev.tx.memo === next.tx.memo &&
    prev.tx.createdAt === next.tx.createdAt &&
    prev.tx.transactionHash === next.tx.transactionHash &&
    prev.tx.from === next.tx.from &&
    prev.tx.to === next.tx.to &&
    prev.index === next.index &&
    prev.focusedIndex === next.focusedIndex &&
    prev.visibleCount === next.visibleCount &&
    prev.isCopied === next.isCopied &&
    prev.note === next.note &&
    prev.isEditingNote === next.isEditingNote &&
    prev.noteInputValue === next.noteInputValue &&
    prev.mintingReceiptHash === next.mintingReceiptHash &&
    sameReceiptHashes(prev.mintedReceiptHashes, next.mintedReceiptHashes)
  );
}

export const TransactionRow = React.memo(TransactionRowInner, areEqual);

// ─── Icons ──────────────────────────────────────────────────────────────────

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
    </svg>
  );
}

function ArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function RepeatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
    </svg>
  );
}

function PrinterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 9V3.75A1.75 1.75 0 018.5 2h7a1.75 1.75 0 011.75 1.75V9M7.5 18.75h9M5.25 9H18.75A2.25 2.25 0 0121 11.25v5.25a1.5 1.5 0 01-1.5 1.5h-2.25V15H6.75v3H4.5A1.5 1.5 0 013 16.5v-5.25A2.25 2.25 0 015.25 9z" />
    </svg>
  );
}
