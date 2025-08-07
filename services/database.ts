import { DatabaseInitializer } from '@/src/infrastructure/database/DatabaseInitializer';
import { useState, useEffect } from 'react';

export const useDatabase = (encryptionKey?: string) => {
  const [isInitialized, setIsInitialized] = useState(DatabaseInitializer.isInitialized());

  useEffect(() => {
    const initializeDatabase = async () => {
      if (!DatabaseInitializer.isInitialized()) {
        await DatabaseInitializer.initialize(encryptionKey);
        setIsInitialized(true);
      }
    };
    initializeDatabase();
  }, [encryptionKey]);

  return isInitialized;
};
