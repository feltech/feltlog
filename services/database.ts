import * as SQLite from 'expo-sqlite';


import { useState, useEffect } from 'react';

export const useDatabase = (encryptionKey: string) => {
    const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);

    useEffect(() => {
        const initializeDatabase = async () => {
            const db = await SQLite.openDatabaseAsync('encrypted.db');
            // Set DB encryption key before making any requests!
            await db.execAsync(`PRAGMA key='${encryptionKey}'`);
            setDb(db);
        };
        initializeDatabase();
    }, [encryptionKey]);

    return db;
};