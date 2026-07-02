import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CopyButton,
  Field,
  Screen,
  TextInput,
  formatError,
  shortAddress,
} from '../components/ui';
import { IconCheck, IconExternalLink } from '../components/icons';
import { useWallet } from '../state/WalletContext';
import { fetchTronBalances, sendUsdt } from '../../services/tronApi';
import { getTronNetworkConfig } from '../../wallet/networks';
import { isValidTronAddress, parseDecimalToUnits, formatUnits } from '../../wallet/validators';
import { TRC20_FEE_LIMIT_SUN, USDT_DECIMALS } from '../../config';

type Step =
  | { name: 'form' }
  | { name: 'confirm'; to: string; amountUnits: bigint }
  | { name: 'sending'; to: string; amountUnits: bigint }
  | { name: 'done'; txid: string };

export function SendUsdt() {
  const navigate = useNavigate();
  const { accounts, settings, mnemonic } = useWallet();
  const [step, setStep] = useState<Step>({ name: 'form' });
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [maxBusy, setMaxBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!accounts || !mnemonic) return null;

  const tronConfig = getTronNetworkConfig(settings.tronNetwork);
  const addressError = to && !isValidTronAddress(to) ? 'Invalid Tron address.' : undefined;
  const amountUnits = parseDecimalToUnits(amount, USDT_DECIMALS);
  const amountError =
    amount && amountUnits === null ? 'Enter a positive amount with up to 6 decimals.' : undefined;
  const canReview = !!to && !addressError && amountUnits !== null;

  const onMax = async () => {
    setMaxBusy(true);
    setError(null);
    try {
      const balances = await fetchTronBalances(settings.tronNetwork, accounts.tron.address);
      if (balances.usdtUnits <= 0n) {
        setError('No USDT balance to send.');
        return;
      }
      setAmount(formatUnits(balances.usdtUnits, USDT_DECIMALS));
    } catch (e) {
      setError(formatError(e));
    } finally {
      setMaxBusy(false);
    }
  };

  const onConfirm = async () => {
    if (step.name !== 'confirm') return;
    setStep({ ...step, name: 'sending' });
    setError(null);
    try {
      const txid = await sendUsdt({
        mnemonic,
        networkId: settings.tronNetwork,
        toAddress: step.to,
        amountUnits: step.amountUnits,
      });
      setStep({ name: 'done', txid });
    } catch (e) {
      setError(formatError(e));
      setStep({ ...step, name: 'confirm' });
    }
  };

  if (step.name === 'done') {
    return (
      <Screen title="Transfer sent">
        <div className="success-ring">
          <IconCheck size={26} />
        </div>
        <Alert kind="success">Your USDT transfer has been broadcast.</Alert>
        <Card>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row">
              <span className="muted" style={{ fontSize: 12.5 }}>
                Transaction ID
              </span>
              <CopyButton value={step.txid} label="Copy" />
            </div>
            <div className="txid-box">{step.txid}</div>
            <a href={tronConfig.explorerTxUrl(step.txid)} target="_blank" rel="noreferrer">
              View on explorer <IconExternalLink size={12} style={{ verticalAlign: -1 }} />
            </a>
          </div>
        </Card>
        <div className="grow" />
        <Button onClick={() => navigate('/dashboard')}>Done</Button>
      </Screen>
    );
  }

  if (step.name === 'confirm' || step.name === 'sending') {
    return (
      <Screen title="Confirm transfer">
        <Card>
          <div className="summary-list">
            <div className="row">
              <span className="label">To</span>
              <span className="value">{shortAddress(step.to)}</span>
            </div>
            <div className="row">
              <span className="label">Amount</span>
              <span className="value">{formatUnits(step.amountUnits, USDT_DECIMALS)} USDT</span>
            </div>
            <div className="row">
              <span className="label">Network</span>
              <span className="value">{tronConfig.label}</span>
            </div>
            <hr className="divider" />
            <div className="row">
              <span className="label">Max fee</span>
              <span className="value">{formatUnits(BigInt(TRC20_FEE_LIMIT_SUN), 6)} TRX</span>
            </div>
          </div>
        </Card>
        <Alert kind="info">
          Fees are paid in TRX. Actual cost is usually far below the max fee limit.
        </Alert>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grow" />
        <Button onClick={onConfirm} loading={step.name === 'sending'}>
          {step.name === 'sending' ? 'Sending…' : 'Confirm & send'}
        </Button>
        <Button
          variant="secondary"
          disabled={step.name === 'sending'}
          onClick={() => setStep({ name: 'form' })}
        >
          Back
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title="Send USDT" back="/dashboard">
      <Field label="Recipient address" error={addressError}>
        <TextInput
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="T…"
          spellCheck={false}
          aria-invalid={!!addressError}
          autoFocus
        />
      </Field>
      <Field label="Amount (USDT)" error={amountError}>
        <div className="input-wrap">
          <TextInput
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="10.50"
            inputMode="decimal"
            aria-invalid={!!amountError}
            style={{ paddingRight: 64 }}
          />
          <Button
            variant="ghost"
            small
            className="input-suffix-btn"
            onClick={onMax}
            loading={maxBusy}
          >
            Max
          </Button>
        </div>
      </Field>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grow" />
      <Button
        onClick={() => {
          if (amountUnits !== null) setStep({ name: 'confirm', to: to.trim(), amountUnits });
        }}
        disabled={!canReview}
      >
        Review transfer
      </Button>
    </Screen>
  );
}
