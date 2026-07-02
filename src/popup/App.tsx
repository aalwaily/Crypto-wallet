import { MemoryRouter } from 'react-router-dom';
import { WalletProvider } from './state/WalletContext';
import { AppRoutes } from './routes';

export function App() {
  return (
    <WalletProvider>
      <MemoryRouter>
        <AppRoutes />
      </MemoryRouter>
    </WalletProvider>
  );
}
