import { useEffect, useState } from 'react';
import type { ConnectivityStatus } from '@/types/operations';

function readInitialConnectivity(): ConnectivityStatus {
  if (typeof navigator === 'undefined') {
    return 'online';
  }

  return navigator.onLine ? 'online' : 'offline';
}

export function useConnectivityStatus(): ConnectivityStatus {
  const [status, setStatus] = useState<ConnectivityStatus>(() => readInitialConnectivity());

  useEffect(() => {
    const handleOnline = () => setStatus('online');
    const handleOffline = () => setStatus('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
}
