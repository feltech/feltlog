import {useEffect} from 'react';
import {Text, View} from 'react-native';
import {useDatabase} from '../database';

const DatabaseTestComponent = ({encryptionKey}: { encryptionKey?: string }) => {
  const {ready, initialize} = useDatabase();

  useEffect(() => {
    // For tests, use a random db name to avoid collisions and always pass a key if provided
    const name = `test_${Date.now()}_${Math.random()}.db`;
    (async () => {
      await initialize({encryptionKey: encryptionKey ?? 'test-key', databaseName: name});
    })();
  }, [encryptionKey]);

  return (
    <View>
      <Text>{ready ? 'Database initialized' : 'Initializing database...'}</Text>
    </View>
  );
};

export default DatabaseTestComponent;
