import * as SQLite from 'expo-sqlite';


// Function to initialize the database
export const initDatabase = async (encryptionKey: string) => {
    const db = await SQLite.openDatabaseAsync('encrypted.db');
    // Set DB encryption key before making any requests!
    await db.execAsync(`PRAGMA key='${encryptionKey}'`);
};
