import { Navigate, Route, Routes } from 'react-router-dom';
import { useWallet } from '../state/WalletContext';
import { Spinner } from '../components/ui';
import { Welcome } from '../screens/Welcome';
import { CreateWallet } from '../screens/CreateWallet';
import { ImportWallet } from '../screens/ImportWallet';
import { BackupSeed } from '../screens/BackupSeed';
import { Unlock } from '../screens/Unlock';
import { Dashboard } from '../screens/Dashboard';
import { History } from '../screens/History';
import { SendBitcoin } from '../screens/SendBitcoin';
import { SendToken } from '../screens/SendToken';
import { Settings } from '../screens/Settings';
import type { ReactNode } from 'react';

/** Redirects to the screen matching the current wallet state. */
function Home() {
  const { status } = useWallet();
  switch (status) {
    case 'loading':
      return (
        <div className="center">
          <Spinner />
        </div>
      );
    case 'no-wallet':
      return <Welcome />;
    case 'locked':
      return <Navigate to="/unlock" replace />;
    case 'unlocked':
      return <Navigate to="/dashboard" replace />;
  }
}

function RequireUnlocked({ children }: { children: ReactNode }) {
  const { status } = useWallet();
  if (status === 'loading') {
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  }
  if (status !== 'unlocked') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<CreateWallet />} />
      <Route path="/import" element={<ImportWallet />} />
      <Route path="/unlock" element={<Unlock />} />
      <Route
        path="/backup"
        element={
          <RequireUnlocked>
            <BackupSeed />
          </RequireUnlocked>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireUnlocked>
            <Dashboard />
          </RequireUnlocked>
        }
      />
      <Route
        path="/history"
        element={
          <RequireUnlocked>
            <History />
          </RequireUnlocked>
        }
      />
      <Route
        path="/send/btc"
        element={
          <RequireUnlocked>
            <SendBitcoin />
          </RequireUnlocked>
        }
      />
      <Route
        path="/send/trc20/:symbol"
        element={
          <RequireUnlocked>
            <SendToken />
          </RequireUnlocked>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireUnlocked>
            <Settings />
          </RequireUnlocked>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
