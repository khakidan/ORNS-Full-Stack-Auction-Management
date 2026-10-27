import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ConfigProvider } from './context/ConfigContext';
import { AuctionProvider } from './context/AuctionContext';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initErrorCapture } from './lib/errorBuffer';

// Must run before the app renders so no early console.error/window error
// is missed from a bug report's "Recent console activity" section.
initErrorCapture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ConfigProvider>
          <AuctionProvider>
            <App />
          </AuctionProvider>
        </ConfigProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
