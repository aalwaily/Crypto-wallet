import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Screen, TextInput, formatError } from '../components/ui';
import { IconCheck, IconPencil, IconPlus, IconTrash } from '../components/icons';
import { useWallet } from '../state/WalletContext';
import type { BtcAddressType } from '../../wallet/bitcoin';

const TYPE_LABEL: Record<BtcAddressType, string> = {
  native: 'Native SegWit · bc1',
  nested: 'Nested SegWit · 3…',
  legacy: 'Legacy · 1…',
};

export function WalletList() {
  const navigate = useNavigate();
  const { wallets, activeId, switchWallet, renameWallet, removeWallet } = useWallet();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSwitch = async (id: string) => {
    if (id === activeId) {
      navigate('/dashboard');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await switchWallet(id);
      navigate('/dashboard');
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  };

  const onRemove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await removeWallet(id);
      setConfirmRemove(null);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Wallets" back="/dashboard">
      {error && <Alert kind="error">{error}</Alert>}

      {wallets.map((w) => (
        <Card key={w.id}>
          <div className="stack" style={{ gap: 10 }}>
            <button
              className="wallet-select"
              onClick={() => onSwitch(w.id)}
              disabled={busy || editingId === w.id}
            >
              <span className={`wallet-dot${w.id === activeId ? ' active' : ''}`} />
              <span style={{ flex: 1, minWidth: 0 }}>
                {editingId === w.id ? (
                  <TextInput
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={24}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span style={{ fontWeight: 650, display: 'block' }}>{w.name}</span>
                )}
                <span className="asset-name" style={{ display: 'block' }}>
                  {TYPE_LABEL[w.btcAddressType]}
                  {w.id === activeId ? ' · active' : ''}
                </span>
              </span>
              {w.id === activeId && <IconCheck size={16} style={{ color: 'var(--primary)' }} />}
            </button>

            <div className="row" style={{ gap: 8, justifyContent: 'flex-start' }}>
              {editingId === w.id ? (
                <>
                  <Button
                    small
                    onClick={async () => {
                      await renameWallet(w.id, editName);
                      setEditingId(null);
                    }}
                  >
                    Save
                  </Button>
                  <Button small variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    small
                    variant="ghost"
                    onClick={() => {
                      setEditingId(w.id);
                      setEditName(w.name);
                    }}
                  >
                    <IconPencil size={14} />
                    Rename
                  </Button>
                  {wallets.length > 1 &&
                    (confirmRemove === w.id ? (
                      <Button small variant="danger" loading={busy} onClick={() => onRemove(w.id)}>
                        Confirm remove
                      </Button>
                    ) : (
                      <Button small variant="ghost" onClick={() => setConfirmRemove(w.id)}>
                        <IconTrash size={14} />
                        Remove
                      </Button>
                    ))}
                </>
              )}
            </div>
            {confirmRemove === w.id && (
              <Alert kind="warn">
                This removes the wallet from this app only. Your coins stay on the blockchain — you
                can restore it anytime with its seed phrase.
              </Alert>
            )}
          </div>
        </Card>
      ))}

      <div className="grow" />
      <Button onClick={() => navigate('/add-wallet')}>
        <IconPlus size={16} />
        Add wallet
      </Button>
    </Screen>
  );
}
