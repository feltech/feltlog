import React from 'react';
import {View, Text} from 'react-native';
import {useDatabase} from '../database';

const DatabaseTestComponent = ({encryptionKey}: { encryptionKey: string }) => {
  const db = useDatabase(encryptionKey);

  return (
    <View>
      <Text>{db ? 'Database initialized' : 'Initializing database...'}</Text>
    </View>
  );
};

export default DatabaseTestComponent;
