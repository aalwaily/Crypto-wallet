import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CopyButton,
  Field,
  Screen,
  Select,
  TextInput,
  formatError,
  shortAddress,
} from '../components/ui';
import { IconCheck, IconExternalLink } from '../components/icons';
import { useWallet } from '../state/WalletContext';
import {
  broadcastTx,
  fetchFeeEstimates,
  fetchUtxos,
  type FeeEstimates,
} from '../../services/bitcoinApi';
import { buildAndSignBtcTx, estimateVsize, type SignedTx } from '../../wallet/bitcoin';
import { getBitcoinJsNetwork, getBtcApiBaseUrl, getBtcNetworkConfig } from '../../wallet/networks';
import { btcToSats, isValidBtcAddress, satsToBtc } from '../../wallet/validators';

type Step =
  | { name: 'form' }
  | { name: 'confirm'; tx: SignedTx; to: string; amountSats: number }
  | { name: 'broadcasting'; tx: SignedTx; to: string; amountSats: number }
  | { name: 'done'; txid: string };

type FeeTier = 'slow' | 'normal' | 'fast';

export function SendBitcoin() {
  const navigate = useNavigate();
  const { accounts, settings, mnemonic } = useWallet();
  const [step, setStep] = useState<Step>({ name: 'form' });
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [feeTier, setFeeTier] = useState<FeeTier>('normal');
  const [fees, setFees] = useState<FeeEstimates | null>(null);
  const [busy, setBusy] = useState(false);
  const [maxBusy, setMaxBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = getBtcApiBaseUrl(settings);
  const btcNetwork = getBitcoinJsNetwork(settings.btcNetwork);
  const explorer = getBtcNetworkConfig(settings.btcNetwork).explorerTxUrl;

  useEffect(() => {
    fetchFeeEstimates(baseUrl)
      .then(setFees)
      .catch(() => setFees({ fastSatPerVb: 3, normalSatPerVb: 2, slowSatPerVb: 1 }));
  }, [baseUrl]);

  if (!accounts || !mnemonic) return null;

  const addressError =
    to && !isValidBtcAddress(to, btcNetwork) ? 'Invalid address for this network.' : undefined;
  const amountSats = btcToSats(amount);
  const amountError =
    amount && amountSats === null ? 'Enter a positive amount with up to 8 decimals.' : undefined;
  const canReview = !!to && !addressError && amountSats !== null && !busy;

  const feeRateFor = (tier: FeeTier): number => {
    if (!fees) return 1;
    return tier === 'fast'
      ? fees.fastSatPerVb
      : tier === 'slow'
        ? fees.slowSatPerVb
        : fees.normalSatPerVb;
  };

  /** Sets the amount to spendable balance minus the fee for a 1-output sweep. */
  const onMax = async () => {
    setMaxBusy(true);
    setError(null);
    try {
      const utxos = (await fetchUtxos(baseUrl, accounts.btc.address)).filter(
        (u) => u.status.confirmed,
      );
      const total = utxos.reduce((sum, u) => sum + u.value, 0);
      const fee = Math.ceil(estimateVsize(utxos.length, 1) * feeRateFor(feeTier));
      const spendable = total - fee;
      if (spendable <= 0) {
        setError('Balance is too small to cover the network fee.');
        return;
      }
      setAmount(satsToBtc(spendable));
    } catch (e) {
      setError(formatError(e));
    } finally {
      setMaxBusy(false);
    }
  };

  const onReview = async () => {
    if (amountSats === null) return;
    setBusy(true);
    setError(null);
    try {
      const utxos = (await fetchUtxos(baseUrl, accounts.btc.address)).filter(
        (u) => u.status.confirmed,
      );
      const tx = await buildAndSignBtcTx({
        mnemonic,
        networkId: settings.btcNetwork,
        utxos,
        toAddress: to.trim(),
        amountSats: Number(amountSats),
        feeRateSatPerVb: feeRateFor(feeTier),
      });
      setStep({ name: 'confirm', tx, to: to.trim(), amountSats: Number(amountSats) });
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (step.name !== 'confirm') return;
    setStep({ ...step, name: 'broadcasting' });
    setError(null);
    try {
      const txid = await broadcastTx(baseUrl, step.tx.hex);
      setStep({ name: 'done', txid });
    } catch (e) {
      setError(formatError(e));
      setStep({ ...step, name: 'confirm' });
    }
  };

  if (step.name === 'done') {
    return (
      <Screen title="Transaction sent">
        <div className="success-ring">
          <IconCheck size={26} />
        </div>
        <Alert kind="success">Your transaction has been broadcast to the network.</Alert>
        <Card>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row">
              <span className="muted" style={{ fontSize: 12.5 }}>
                Transaction ID
              </span>
              <CopyButton value={step.txid} label="Copy" />
            </div>
            <div className="txid-box">{step.txid}</div>
            <a href={explorer(step.txid)} target="_blank" rel="noreferrer">
              View on explorer <IconExternalLink size={12} style={{ verticalAlign: -1 }} />
            </a>
          </div>
        </Card>
        <div className="grow" />
        <Button onClick={() => navigate('/dashboard')}>Done</Button>
      </Screen>
    );
  }

  if (step.name === 'confirm' || step.name === 'broadcasting') {
    const total = step.amountSats + step.tx.feeSats;
    return (
      <Screen title="Confirm transaction">
        <Card>
          <div className="summary-list">
            <div className="row">
              <span className="label">To</span>
              <span className="value">{shortAddress(step.to)}</span>
            </div>
            <div className="row">
              <span className="label">Amount</span>
              <span className="value">{satsToBtc(step.amountSats)} BTC</span>
            </div>
            <div className="row">
              <span className="label">Network fee</span>
              <span className="value">
                {satsToBtc(step.tx.feeSats)} BTC · {step.tx.vsize} vB
              </span>
            </div>
            <hr className="divider" />
            <div className="row">
              <span className="label">Total</span>
              <span className="value">
                <strong>{satsToBtc(total)} BTC</strong>
              </span>
            </div>
          </div>
        </Card>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grow" />
        <Button onClick={onConfirm} loading={step.name === 'broadcasting'}>
          {step.name === 'broadcasting' ? 'Broadcasting…' : 'Confirm & send'}
        </Button>
        <Button
          variant="secondary"
          disabled={step.name === 'broadcasting'}
          onClick={() => setStep({ name: 'form' })}
        >
          Back
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title="Send Bitcoin" back="/dashboard">
      <Field label="Recipient address" error={addressError}>
        <TextInput
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={settings.btcNetwork === 'testnet' ? 'tb1…' : 'bc1…'}
          spellCheck={false}
          aria-invalid={!!addressError}
          autoFocus
        />
      </Field>
      <Field label="Amount (BTC)" error={amountError}>
        <div className="input-wrap">
          <TextInput
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0001"
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
      <Field label="Fee" hint="Estimated from current network conditions.">
        <Select value={feeTier} onChange={(e) => setFeeTier(e.target.value as FeeTier)}>
          <option value="slow">Slow — {feeRateFor('slow')} sat/vB</option>
          <option value="normal">Normal — {feeRateFor('normal')} sat/vB</option>
          <option value="fast">Fast — {feeRateFor('fast')} sat/vB</option>
        </Select>
      </Field>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grow" />
      <Button onClick={onReview} disabled={!canReview} loading={busy}>
        Review transaction
      </Button>
    </Screen>
  );
}
