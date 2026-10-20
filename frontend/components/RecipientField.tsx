import { useRef, useState } from 'react';
import {
  isValidStellarAddress,
  resolveFederationAddress,
} from '@/lib/stellar';
import { resolveSNSDomain } from '@/utils/snsResolver';
import { useTranslation } from '@/contexts/I18nContext';
import ContactPickerModal from './ContactPickerModal';

interface FavouriteEntry {
  name: string;
  address: string;
}

interface RecipientFieldProps {
  value: string;
  onChange: (value: string) => void;
  onContactPickerOpen?: () => void;
  onScannerOpen?: () => void;
  hideDestinationField?: boolean;
  destinationReadOnly?: boolean;
  isScannerSupported?: boolean;
  favourites?: FavouriteEntry[];
  isResolvingFederation?: boolean;
  federationError?: string | null;
  isResolvingSNS?: boolean;
  snsError?: string | null;
  showContactPicker?: boolean;
  onContactPickerClose?: () => void;
  onContactSelect?: (address: string) => void;
}

export default function RecipientField({
  value,
  onChange,
  onContactPickerOpen,
  onScannerOpen,
  hideDestinationField = false,
  destinationReadOnly = false,
  isScannerSupported = false,
  favourites = [],
  isResolvingFederation = false,
  federationError,
  isResolvingSNS = false,
  snsError,
  showContactPicker = false,
  onContactPickerClose,
  onContactSelect,
}: RecipientFieldProps) {
  const { t } = useTranslation();
  const [isFavouritesDropdownOpen, setIsFavouritesDropdownOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  if (hideDestinationField) {
    return null;
  }

  const contactSuggestions = favourites.filter(
    (f) =>
      value.length > 0 &&
      (f.name.toLowerCase().includes(value.toLowerCase()) ||
        f.address.startsWith(value))
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!contactSuggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((i) => (i + 1) % contactSuggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((i) => (i - 1 + contactSuggestions.length) % contactSuggestions.length);
    } else if (e.key === 'Enter' && contactSuggestions[activeSuggestion]) {
      e.preventDefault();
      onChange(contactSuggestions[activeSuggestion].address);
      setActiveSuggestion(0);
    } else if (e.key === 'Escape') {
      setActiveSuggestion(0);
      onChange('');
    }
  };

  const handleSelectSuggestion = (address: string) => {
    onChange(address);
    setActiveSuggestion(0);
    setIsFavouritesDropdownOpen(false);
  };

  const isValid = value.length === 0 || isValidStellarAddress(value);
  const isResolving = isResolvingFederation || isResolvingSNS;
  const resolutionError = federationError || snsError;

  return (
    <>
      <div className="relative">
        <label className="label">{t('sendPayment.recipientLabel')}</label>
        <div className="relative">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setIsFavouritesDropdownOpen(true);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFavouritesDropdownOpen(contactSuggestions.length > 0)}
            onBlur={() => setTimeout(() => setIsFavouritesDropdownOpen(false), 200)}
            placeholder={t('sendPayment.recipientPlaceholder')}
            readOnly={destinationReadOnly}
            className={`input-field ${!isValid ? 'border-red-500' : ''} ${isResolving ? 'opacity-75' : ''}`}
            disabled={isResolving}
          />

          {isResolving && (
            <div className="absolute right-3 top-9 text-slate-400 text-sm">
              {t('sendPayment.resolving')}
            </div>
          )}

          {resolutionError && (
            <p className="text-red-400 text-sm mt-1">{resolutionError}</p>
          )}

          {!isValid && !isResolving && (
            <p className="text-red-400 text-sm mt-1">
              {t('sendPayment.invalidAddress')}
            </p>
          )}

          {/* Suggestions Dropdown */}
          {isFavouritesDropdownOpen && contactSuggestions.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute top-full mt-1 w-full bg-slate-800 border border-slate-700 rounded shadow-lg z-10"
            >
              {contactSuggestions.map((suggestion, i) => (
                <button
                  key={suggestion.address}
                  onClick={() => handleSelectSuggestion(suggestion.address)}
                  className={`w-full text-left px-3 py-2 text-sm ${
                    i === activeSuggestion
                      ? 'bg-stellar-500/20 text-stellar-300'
                      : 'text-slate-300 hover:bg-slate-700/50'
                  }`}
                  type="button"
                >
                  <div className="font-medium">{suggestion.name}</div>
                  <div className="text-xs text-slate-400">{suggestion.address}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-2">
          {isScannerSupported && (
            <button
              onClick={onScannerOpen}
              className="btn-secondary flex-1 text-sm py-1.5"
              type="button"
            >
              {t('sendPayment.scanQr')}
            </button>
          )}
          <button
            onClick={onContactPickerOpen}
            className="btn-secondary flex-1 text-sm py-1.5"
            type="button"
          >
            {t('sendPayment.pickContact')}
          </button>
        </div>
      </div>

      {showContactPicker && onContactPickerClose && onContactSelect && (
        <ContactPickerModal
          isOpen={showContactPicker}
          onClose={onContactPickerClose}
          // The picker hands back a whole contact; this field only cares
          // about the address it fills in.
          onSelect={(contact) => onContactSelect(contact.address)}
        />
      )}
    </>
  );
}
