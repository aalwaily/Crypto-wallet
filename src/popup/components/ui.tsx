/** Shared UI primitives for the popup. */
import {
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconHistory,
  IconInbox,
  IconInfo,
  IconSettings,
  IconWallet,
} from './icons';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  small?: boolean;
  iconOnly?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  small,
  iconOnly,
  loading,
  children,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn-${variant}`];
  if (small) classes.push('btn-sm');
  if (iconOnly) classes.push('btn-sm', 'btn-icon');
  if (className) classes.push(className);
  return (
    <button className={classes.join(' ')} disabled={disabled || loading} {...rest}>
      {loading && <span className="spinner" />}
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
      {!error && hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

const alertIcons = {
  error: IconAlertTriangle,
  warn: IconAlertTriangle,
  success: IconCheck,
  info: IconInfo,
} as const;

export function Alert({
  kind,
  children,
}: {
  kind: 'error' | 'success' | 'warn' | 'info';
  children: ReactNode;
}) {
  const Icon = alertIcons[kind];
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}

export function Spinner() {
  return <span className="spinner" style={{ color: 'var(--primary)' }} />;
}

export function Skeleton({ width, height = 16 }: { width: number | string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden />;
}

interface ScreenProps {
  title?: ReactNode;
  back?: string;
  actions?: ReactNode;
  withTabBar?: boolean;
  children: ReactNode;
}

export function Screen({ title, back, actions, withTabBar, children }: ScreenProps) {
  const navigate = useNavigate();
  return (
    <div className={`screen${withTabBar ? ' has-tabbar' : ''}`}>
      {(title || back || actions) && (
        <div className="screen-header">
          {back && (
            <Button variant="ghost" iconOnly aria-label="Back" onClick={() => navigate(back)}>
              <IconArrowLeft />
            </Button>
          )}
          {title && <h2>{title}</h2>}
          {actions && <div className="header-actions">{actions}</div>}
        </div>
      )}
      {children}
      {withTabBar && <TabBar />}
    </div>
  );
}

const tabs = [
  { path: '/dashboard', label: 'Wallet', icon: IconWallet },
  { path: '/history', label: 'History', icon: IconHistory },
  { path: '/settings', label: 'Settings', icon: IconSettings },
] as const;

export function TabBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <nav className="tabbar" aria-label="Main navigation">
      {tabs.map(({ path, label, icon: Icon }) => (
        <button
          key={path}
          aria-current={pathname === path}
          aria-label={label}
          onClick={() => navigate(path)}
        >
          <Icon size={20} />
          {label}
        </button>
      ))}
    </nav>
  );
}

export function NetworkBadge({
  label,
  variant = 'warn',
}: {
  label: string;
  variant?: 'warn' | 'danger';
}) {
  return (
    <span className={`badge${variant === 'danger' ? ' badge-danger' : ''}`}>
      <span className="badge-dot" />
      {label}
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      iconOnly={!label}
      small={!!label}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
      {label && (copied ? 'Copied' : label)}
    </Button>
  );
}

export function AddressDisplay({ address }: { address: string }) {
  return (
    <div className="address-box">
      <span className="address-text">{address}</span>
      <CopyButton value={address} />
    </div>
  );
}

export function QrCode({ value }: { value: string }) {
  return (
    <div className="qr-wrap">
      <QRCodeSVG value={value} size={164} marginSize={1} />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <IconInbox size={32} />
      <span className="empty-title">{title}</span>
      {hint && <span style={{ fontSize: 12.5 }}>{hint}</span>}
    </div>
  );
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function formatTime(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestampMs).toLocaleDateString();
}
