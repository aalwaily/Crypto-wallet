import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Field, Screen, TextInput, formatError } from '../components/ui';
import { IconWallet } from '../components/icons';
import { useWallet } from '../state/WalletContext';

export function Unlock() {
  const navigate = useNavigate();
  const { unlock } = useWallet();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(formatError(err));
      setBusy(false);
      setPassword('');
    }
  };

  return (
    <Screen>
      <form onSubmit={onSubmit} className="center" style={{ gap: 14 }}>
        <div className="logo">
          <IconWallet size={28} />
        </div>
        <h2>Unlock wallet</h2>
        <div style={{ width: '100%' }}>
          <Field label="Password">
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </Field>
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" disabled={!password} loading={busy}>
          Unlock
        </Button>
      </form>
    </Screen>
  );
}
