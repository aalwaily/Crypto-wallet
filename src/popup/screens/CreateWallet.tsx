import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Field, Screen, TextInput, formatError } from '../components/ui';
import { generateMnemonic } from '../../wallet/mnemonic';
import { useWallet } from '../state/WalletContext';
import { MIN_PASSWORD_LENGTH } from '../../config';

export function CreateWallet() {
  const navigate = useNavigate();
  const { createWallet } = useWallet();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordError =
    password && password.length < MIN_PASSWORD_LENGTH
      ? `At least ${MIN_PASSWORD_LENGTH} characters.`
      : undefined;
  const confirmError = confirm && confirm !== password ? 'Passwords do not match.' : undefined;
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH && password === confirm && !busy;

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const mnemonic = generateMnemonic();
      await createWallet(mnemonic, password);
      navigate('/backup', { replace: true });
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  };

  return (
    <Screen title="Create wallet" back="/">
      <p className="muted">
        Choose a password. It encrypts your seed phrase on this device and is required to unlock
        the wallet. It cannot be recovered if forgotten.
      </p>
      <Field label="Password" error={passwordError}>
        <TextInput
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Confirm password" error={confirmError}>
        <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grow" />
      <Button onClick={onCreate} disabled={!canSubmit} loading={busy}>
        Create wallet
      </Button>
    </Screen>
  );
}
