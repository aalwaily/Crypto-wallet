import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Screen } from '../components/ui';
import { useWallet } from '../state/WalletContext';

export function BackupSeed() {
  const navigate = useNavigate();
  const { mnemonic } = useWallet();
  const [revealed, setRevealed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  if (!mnemonic) return null; // route guard redirects when locked

  const words = mnemonic.split(' ');

  return (
    <Screen title="Backup seed phrase">
      <Alert kind="warn">
        Write these words down on paper, in order. Anyone with this phrase can steal your funds.
        Never share it and never enter it on a website.
      </Alert>
      <div className={`seed-grid${revealed ? '' : ' seed-blur'}`}>
        {words.map((word, i) => (
          <span key={i} className="seed-word">
            <span className="idx">{i + 1}</span> {word}
          </span>
        ))}
      </div>
      {!revealed && (
        <Button variant="secondary" onClick={() => setRevealed(true)}>
          Reveal seed phrase
        </Button>
      )}
      <div className="grow" />
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>I have written down my seed phrase and stored it somewhere safe.</span>
      </label>
      <Button disabled={!confirmed || !revealed} onClick={() => navigate('/dashboard', { replace: true })}>
        Continue to wallet
      </Button>
    </Screen>
  );
}
