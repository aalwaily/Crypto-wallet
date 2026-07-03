import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Field,
  Screen,
  TextArea,
  TextInput,
  formatError,
} from '../components/ui';
import { normalizeMnemonic, validateMnemonic } from '../../wallet/mnemonic';
import { detectFundedBtcType } from '../../wallet/btcDetect';
import { useWallet } from '../state/WalletContext';

export function AddWallet() {
  const navigate = useNavigate();
  const { addWallet, settings, wallets } = useWallet();
  const [phrase, setPhrase] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeMnemonic(phrase);
  const wordCount = normalized ? normalized.split(' ').length : 0;
  const phraseError =
    phrase && !validateMnemonic(normalized)
      ? `Not a valid seed phrase (${wordCount} words).`
      : undefined;
  const canSubmit = validateMnemonic(normalized) && password.length > 0 && !busy;

  const onAdd = async () => {
    setBusy(true);
    setError(null);
    try {
      const btcType = await detectFundedBtcType(normalized, settings);
      const walletName = name.trim() || `Wallet ${wallets.length + 1}`;
      await addWallet(normalized, password, walletName, btcType);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  };

  return (
    <Screen title="Add wallet" back="/wallets">
      <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
        Paste the 12 or 24 words of another wallet (from this app, Trust, or any BIP39 wallet). Its
        Bitcoin and Tron accounts will appear.
      </p>
      <Field label="Seed phrase" error={phraseError}>
        <TextArea
          rows={3}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="word1 word2 word3 …"
          spellCheck={false}
          autoFocus
        />
      </Field>
      <Field label="Wallet name (optional)">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Wallet ${wallets.length + 1}`}
          maxLength={24}
        />
      </Field>
      <Field label="Your app password" hint="Same password you unlock this wallet with.">
        <TextInput
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && <Alert kind="error">{error}</Alert>}
      <Alert kind="warn">
        Only import a seed you own. Keep a paper backup of these words — this app is a hot wallet.
      </Alert>
      <div className="grow" />
      <Button onClick={onAdd} disabled={!canSubmit} loading={busy}>
        {busy ? 'Adding…' : 'Add wallet'}
      </Button>
    </Screen>
  );
}
