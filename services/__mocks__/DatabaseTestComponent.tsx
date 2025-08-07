import React from 'react';
import {View, Text} from 'react-native';
import {useDatabase} from '../database';

const DatabaseTestComponent = ({encryptionKey}: { encryptionKey?: string }) => {
  const isInitialized = useDatabase(encryptionKey);

  return (
    <View>
      <Text>{isInitialized ? 'Database initialized' : 'Initializing database...'}</Text>
    </View>
  );
};

export default DatabaseTestComponent;
