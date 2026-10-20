import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MultiSigFlow from '@/components/MultiSigFlow';

jest.mock('@/lib/stellar', () => ({
  buildPaymentTransaction: jest.fn(),
  collectSignatures: jest.fn(),
  submitTransaction: jest.fn(),
  isValidStellarAddress: jest.fn((addr) => addr.startsWith('G') && addr.length === 56),
  getNetworkPassphrase: jest.fn(() => 'Test SDF Network ; September 2015'),
}));

jest.mock('@/lib/wallet', () => ({
  signTransactionWithWallet: jest.fn(),
}));

jest.mock('@/contexts/I18nContext', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      const translations: Record<string, string> = {
        'multiSig.title': 'Multi-Signature Transaction',
        'multiSig.recipientAddress': 'Recipient Address',
        'multiSig.amountLabel': 'Amount (XLM)',
        'multiSig.memoLabel': 'Memo',
        'multiSig.memoPlaceholder': 'Optional memo...',
        'multiSig.thresholdLabel': 'Signature Threshold',
        'multiSig.buildTransaction': 'Build Transaction',
        'multiSig.building': 'Building...',
        'multiSig.buildFailed': 'Failed to build transaction',
        'multiSig.shareUrl': 'Share this URL with your co-signers:',
        'multiSig.copyUrl': 'Copy URL',
        'multiSig.proceedToCollect': 'Proceed to Collect Signatures',
        'multiSig.signaturesCollected': `Signatures collected: ${params?.collected ?? 0}/${params?.threshold ?? 0}`,
        'multiSig.pasteSignedXdr': 'Paste Signed XDR',
        'multiSig.addSignature': 'Add Signature',
        'multiSig.proceedToSubmit': 'Proceed to Submit',
        'multiSig.readyToSubmit': 'Ready to submit with ${params?.count ?? 0} signature(s)',
        'multiSig.submitTransaction': 'Submit Transaction',
        'multiSig.submitting': 'Submitting...',
        'multiSig.submitFailed': 'Failed to submit transaction',
        'multiSig.signFailed': 'Failed to sign transaction',
        'multiSig.signatureHint': `Signer ${params?.index ?? 0}: ${params?.hint ?? ''}`,
      };
      return translations[key] || key;
    },
  }),
}));

describe('MultiSigFlow', () => {
  const defaultProps = {
    publicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ',
    xlmBalance: '100.0000000',
    onSuccess: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // `clearAllMocks` only resets the recorded calls, not the queue of
    // `*Once` implementations. A build mock that a previous test queued but
    // never consumed would therefore satisfy the next test's build, so the
    // transaction mocks are reset explicitly here.
    const { buildPaymentTransaction, collectSignatures, submitTransaction } =
      require('@/lib/stellar');
    buildPaymentTransaction.mockReset();
    collectSignatures.mockReset();
    submitTransaction.mockReset();
  });

  describe('Build Step', () => {
    it('renders build step with input fields', () => {
      render(<MultiSigFlow {...defaultProps} />);

      expect(screen.getByLabelText('Recipient Address')).toBeInTheDocument();
      expect(screen.getByLabelText('Amount (XLM)')).toBeInTheDocument();
      expect(screen.getByLabelText('Memo')).toBeInTheDocument();
      expect(screen.getByLabelText('Signature Threshold')).toBeInTheDocument();
    });

    it('disables build button with invalid inputs', () => {
      render(<MultiSigFlow {...defaultProps} />);

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      expect(buildBtn).toBeDisabled();
    });

    it('enables build button with valid inputs', async () => {
      const { buildPaymentTransaction } = require('@/lib/stellar');
      buildPaymentTransaction.mockResolvedValueOnce({
        toXDR: () => 'AAAA...',
      });

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      const destInput = screen.getByPlaceholderText('G...');
      const amountInput = screen.getByPlaceholderText('0.0');
      const thresholdInput = screen.getByRole('spinbutton', { name: 'Signature Threshold' });

      await user.type(destInput, 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(amountInput, '10');
      await user.clear(thresholdInput);
      await user.type(thresholdInput, '2');

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      expect(buildBtn).not.toBeDisabled();
    });

    it('builds transaction and moves to share step', async () => {
      const { buildPaymentTransaction } = require('@/lib/stellar');
      buildPaymentTransaction.mockResolvedValueOnce({
        toXDR: () => 'AAAA...',
      });

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      await user.type(screen.getByPlaceholderText('G...'), 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(screen.getByPlaceholderText('0.0'), '10');

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      await user.click(buildBtn);

      await waitFor(() => {
        expect(screen.getByText('Share this URL with your co-signers:')).toBeInTheDocument();
      });
    });

    it('displays error on build failure', async () => {
      const { buildPaymentTransaction } = require('@/lib/stellar');
      buildPaymentTransaction.mockRejectedValueOnce(new Error('Build failed'));

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      await user.type(screen.getByPlaceholderText('G...'), 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(screen.getByPlaceholderText('0.0'), '10');

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      await user.click(buildBtn);

      await waitFor(() => {
        expect(screen.getByText('Build failed')).toBeInTheDocument();
      });
    });
  });

  describe('Share Step', () => {
    it('displays shareable URL', async () => {
      const { buildPaymentTransaction } = require('@/lib/stellar');
      buildPaymentTransaction.mockResolvedValueOnce({
        toXDR: () => 'AAAA...',
      });

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      await user.type(screen.getByPlaceholderText('G...'), 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(screen.getByPlaceholderText('0.0'), '10');

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      await user.click(buildBtn);

      await waitFor(() => {
        const urlInput = screen.getByDisplayValue(/multi-sig-sign\?xdr=/);
        expect(urlInput).toBeInTheDocument();
      });
    });

    it('copies URL to clipboard', async () => {
      const { buildPaymentTransaction } = require('@/lib/stellar');
      buildPaymentTransaction.mockResolvedValueOnce({
        toXDR: () => 'AAAA...',
      });

      const clipboardSpy = jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValueOnce(undefined);

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      await user.type(screen.getByPlaceholderText('G...'), 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(screen.getByPlaceholderText('0.0'), '10');

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      await user.click(buildBtn);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Copy URL' }));

      await waitFor(() => {
        expect(clipboardSpy).toHaveBeenCalled();
      });

      clipboardSpy.mockRestore();
    });

    it('proceeds to collect step', async () => {
      const { buildPaymentTransaction } = require('@/lib/stellar');
      buildPaymentTransaction.mockResolvedValueOnce({
        toXDR: () => 'AAAA...',
      });

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      await user.type(screen.getByPlaceholderText('G...'), 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(screen.getByPlaceholderText('0.0'), '10');

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      await user.click(buildBtn);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Proceed to Collect Signatures' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Proceed to Collect Signatures' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Paste Signed XDR')).toBeInTheDocument();
      });
    });
  });

  describe('Collect Step', () => {
    it('adds signatures to the list', async () => {
      const { buildPaymentTransaction } = require('@/lib/stellar');
      buildPaymentTransaction.mockResolvedValueOnce({
        toXDR: () => 'AAAA...',
      });

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      // Build
      await user.type(screen.getByPlaceholderText('G...'), 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(screen.getByPlaceholderText('0.0'), '10');
      await user.click(screen.getByRole('button', { name: 'Build Transaction' }));

      // Proceed to collect
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Proceed to Collect Signatures' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Proceed to Collect Signatures' }));

      // Add signature
      await waitFor(() => {
        expect(screen.getByLabelText('Paste Signed XDR')).toBeInTheDocument();
      });

      const xdrInput = screen.getByPlaceholderText('AAAA...');
      await user.type(xdrInput, 'SIGNED_XDR_1');

      await user.click(screen.getByRole('button', { name: 'Add Signature' }));

      // Verify signature was added (should clear the input and show collected count)
      await waitFor(() => {
        expect((screen.getByPlaceholderText('AAAA...') as HTMLTextAreaElement).value).toBe('');
      });
    });

    it('disables submit button until threshold is met', async () => {
      const { buildPaymentTransaction } = require('@/lib/stellar');
      buildPaymentTransaction.mockResolvedValueOnce({
        toXDR: () => 'AAAA...',
      });

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      // Build with threshold of 2
      await user.type(screen.getByPlaceholderText('G...'), 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(screen.getByPlaceholderText('0.0'), '10');
      await user.click(screen.getByRole('button', { name: 'Build Transaction' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Proceed to Collect Signatures' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Proceed to Collect Signatures' }));

      // Add only one signature
      await waitFor(() => {
        expect(screen.getByLabelText('Paste Signed XDR')).toBeInTheDocument();
      });

      const xdrInput = screen.getByPlaceholderText('AAAA...');
      await user.type(xdrInput, 'SIGNED_XDR_1');
      await user.click(screen.getByRole('button', { name: 'Add Signature' }));

      // Should not have Proceed to Submit yet
      await waitFor(() => {
        const proceedButtons = screen.queryAllByRole('button', { name: 'Proceed to Submit' });
        expect(proceedButtons.length).toBe(0);
      });
    });
  });

  describe('Submit Step', () => {
    it('submits transaction after collecting enough signatures', async () => {
      const { buildPaymentTransaction, collectSignatures, submitTransaction } = require('@/lib/stellar');
      const { signTransactionWithWallet } = require('@/lib/wallet');

      buildPaymentTransaction.mockResolvedValueOnce({
        toXDR: () => 'AAAA...',
      });

      collectSignatures.mockResolvedValueOnce('COLLECTED_XDR');
      signTransactionWithWallet.mockResolvedValueOnce({ signedXDR: 'FINAL_XDR' });
      submitTransaction.mockResolvedValueOnce({ hash: 'txhash123' });

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      // Build
      await user.type(screen.getByPlaceholderText('G...'), 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(screen.getByPlaceholderText('0.0'), '10');
      await user.click(screen.getByRole('button', { name: 'Build Transaction' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Proceed to Collect Signatures' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Proceed to Collect Signatures' }));

      // Add two signatures (default threshold is 2)
      await waitFor(() => {
        expect(screen.getByLabelText('Paste Signed XDR')).toBeInTheDocument();
      });

      const xdrInput = screen.getByPlaceholderText('AAAA...');
      await user.type(xdrInput, 'SIGNED_XDR_1');
      await user.click(screen.getByRole('button', { name: 'Add Signature' }));

      await user.type(xdrInput, 'SIGNED_XDR_2');
      await user.click(screen.getByRole('button', { name: 'Add Signature' }));

      // Proceed to submit
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Proceed to Submit' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Proceed to Submit' }));

      // Submit
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Submit Transaction' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Submit Transaction' }));

      await waitFor(() => {
        expect(submitTransaction).toHaveBeenCalled();
        expect(defaultProps.onSuccess).toHaveBeenCalled();
      });
    });

    it('displays error on submit failure', async () => {
      const { buildPaymentTransaction, collectSignatures } = require('@/lib/stellar');
      const { signTransactionWithWallet } = require('@/lib/wallet');

      buildPaymentTransaction.mockResolvedValueOnce({
        toXDR: () => 'AAAA...',
      });

      collectSignatures.mockResolvedValueOnce('COLLECTED_XDR');
      signTransactionWithWallet.mockResolvedValueOnce({ signedXDR: 'FINAL_XDR' });

      const { submitTransaction } = require('@/lib/stellar');
      submitTransaction.mockRejectedValueOnce(new Error('Network error'));

      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      // Build
      await user.type(screen.getByPlaceholderText('G...'), 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(screen.getByPlaceholderText('0.0'), '10');
      await user.click(screen.getByRole('button', { name: 'Build Transaction' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Proceed to Collect Signatures' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Proceed to Collect Signatures' }));

      // Add two signatures
      await waitFor(() => {
        expect(screen.getByLabelText('Paste Signed XDR')).toBeInTheDocument();
      });

      const xdrInput = screen.getByPlaceholderText('AAAA...');
      await user.type(xdrInput, 'SIGNED_XDR_1');
      await user.click(screen.getByRole('button', { name: 'Add Signature' }));

      await user.type(xdrInput, 'SIGNED_XDR_2');
      await user.click(screen.getByRole('button', { name: 'Add Signature' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Proceed to Submit' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Proceed to Submit' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Submit Transaction' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Submit Transaction' }));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });

  describe('Validation', () => {
    it('validates destination address', async () => {
      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      const destInput = screen.getByPlaceholderText('G...');
      const amountInput = screen.getByPlaceholderText('0.0');

      await user.type(destInput, 'INVALID');
      await user.type(amountInput, '10');

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      expect(buildBtn).toBeDisabled();
    });

    it('validates amount against balance', async () => {
      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      const destInput = screen.getByPlaceholderText('G...');
      const amountInput = screen.getByPlaceholderText('0.0');

      await user.type(destInput, 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(amountInput, '200'); // Exceeds balance of 100

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      expect(buildBtn).toBeDisabled();
    });

    it('validates threshold is at least 2', async () => {
      render(<MultiSigFlow {...defaultProps} />);
      const user = userEvent.setup();

      const destInput = screen.getByPlaceholderText('G...');
      const amountInput = screen.getByPlaceholderText('0.0');
      const thresholdInput = screen.getByRole('spinbutton', { name: 'Signature Threshold' });

      await user.type(destInput, 'GDEST123456789012345678901234567890123456789012345678901');
      await user.type(amountInput, '10');
      // The threshold field is controlled and snaps an empty value back to
      // its minimum of 2, so the value is set directly instead of being
      // cleared and retyped.
      fireEvent.change(thresholdInput, { target: { value: '1' } });

      const buildBtn = screen.getByRole('button', { name: 'Build Transaction' });
      expect(buildBtn).toBeDisabled();
    });
  });
});
