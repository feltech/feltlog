import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { ColorValue } from 'react-native';
import { useTheme } from 'react-native-paper';

import { useClientOnlyValue } from './useClientOnlyValue';

// You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
/**
 * Icon component for the tab bar.
 *
 * @param props The component props.
 * @param props.name The name of the FontAwesome icon.
 * @param props.color The color of the icon.
 *
 * @returns The rendered icon component.
 */
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: ColorValue;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

/**
 * Layout component for the tab navigation.
 *
 * @returns The rendered tab layout.
 */
export default function TabLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Journal',
          tabBarIcon: ({ color }) => <TabBarIcon name="book" color={color} />,
          // The Journal screen renders its own custom Appbar.Header so Maestro can
          // interact with the filter and create-entry actions (the native Stack
          // header wraps headerRight in an opaque ViewGroup that strips testIDs).
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="Settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabBarIcon name="cog" color={color} />,
        }}
      />
      <Tabs.Screen
        name="lock"
        options={{
          title: 'Lock',
          tabBarIcon: ({ color }) => <TabBarIcon name="lock" color={color} />,
        }}
      />
    </Tabs>
  );
}
