import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearLastDatabaseName,
  getLastDatabaseName,
  setLastDatabaseName
} from '../dbLocationStorage';

describe('dbLocationStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns null when nothing stored', async () => {
    const name = await getLastDatabaseName();
    expect(name).toBeNull();
  });

  it('persists and retrieves last database name', async () => {
    await setLastDatabaseName('mydb.db');
    const name = await getLastDatabaseName();
    expect(name).toBe('mydb.db');
  });

  it('clears stored database name', async () => {
    await setLastDatabaseName('temp.db');
    await clearLastDatabaseName();
    const name = await getLastDatabaseName();
    expect(name).toBeNull();
  });
});
