import { useNavigate } from 'react-router-dom';
import { Alert, Button, NetworkBadge, Screen, openRecoveryTab } from '../components/ui';
import { IconWallet } from '../components/icons';

export function Welcome() {
  const navigate = useNavigate();
  return (
    <Screen>
      <div className="center">
        <div className="logo">
          <IconWallet size={28} />
        </div>
        <h2 style={{ letterSpacing: '-0.02em' }}>Private BTC · TRC20 Wallet</h2>
        <p className="muted" style={{ maxWidth: 260 }}>
          Non-custodial wallet for Bitcoin and USDT-TRC20. Your keys never leave this device.
        </p>
        <NetworkBadge label="Starts on testnet" />
      </div>
      <Alert kind="warn">
        This wallet is <strong>not audited</strong>. It starts on test networks; enabling mainnet
        in Settings is at your own risk — keep only small amounts.
      </Alert>
      <Button onClick={() => navigate('/create')}>Create new wallet</Button>
      <Button variant="secondary" onClick={() => navigate('/import')}>
        Import existing wallet
      </Button>
      <Button variant="ghost" onClick={openRecoveryTab}>
        Recover a wallet (lost word order)
      </Button>
    </Screen>
  );
}
