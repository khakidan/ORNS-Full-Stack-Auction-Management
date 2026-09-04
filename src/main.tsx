import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ConfigProvider } from './context/ConfigContext';
import { AuctionProvider } from './context/AuctionContext';
import { AuthProvider } from './context/AuthContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider>
      <AuthProvider>
        <AuctionProvider>
          <App />
        </AuctionProvider>
      </AuthProvider>
    </ConfigProvider>
  </StrictMode>,
);
