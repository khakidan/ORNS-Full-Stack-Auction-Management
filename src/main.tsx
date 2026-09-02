import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ConfigProvider } from './context/ConfigContext';
import { AuctionProvider } from './context/AuctionContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider>
      <AuctionProvider>
        <App />
      </AuctionProvider>
    </ConfigProvider>
  </StrictMode>,
);
