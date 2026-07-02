import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Field, Screen, TextArea, TextInput, formatError } from '../components/ui';
import { normalizeMnemonic, validateMnemonic } from '../../wallet/mnemonic';
import { useWallet } from '../state/WalletContext';
import { MIN_PASSWORD_LENGTH } from '../../config';

export function ImportWallet() {
  const navigate = useNavigate();
  const { createWallet } = useWallet();
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeMnemonic(phrase);
  const wordCount = normalized ? normalized.split(' ').length : 0;
  const phraseError =
    phrase && !validateMnemonic(normalized)
      ? `Not a valid BIP39 phrase (${wordCount} words).`
      : undefined;
  const passwordError =
    password && password.length < MIN_PASSWORD_LENGTH
      ? `At least ${MIN_PASSWORD_LENGTH} characters.`
      : undefined;
  const confirmError = confirm && confirm !== password ? 'Passwords do not match.' : undefined;
  const canSubmit =
    validateMnemonic(normalized) &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirm &&
    !busy;

  const onImport = async () => {
    setBusy(true);
    setError(null);
    try {
      await createWallet(normalized, password);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  };

  return (
    <Screen title="Import wallet" back="/">
      <Field label="Seed phrase (12 or 24 words)" error={phraseError}>
        <TextArea
          rows={3}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="word1 word2 word3 …"
          autoFocus
          spellCheck={false}
        />
      </Field>
      <Field label="New password" error={passwordError}>
        <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirm password" error={confirmError}>
        <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grow" />
      <Button onClick={onImport} disabled={!canSubmit} loading={busy}>
        Import wallet
      </Button>
    </Screen>
  );
}
