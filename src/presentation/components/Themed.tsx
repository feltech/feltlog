/** Learn more about Light and Dark modes: https://docs.expo.io/guides/color-schemes/ */

import { Text as DefaultText, useColorScheme, View as DefaultView } from 'react-native';

import Colors from '@/src/presentation/constants/Colors';

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export type TextProps = ThemeProps & DefaultText['props'];
export type ViewProps = ThemeProps & DefaultView['props'];

/**
 * Custom hook to get a theme-dependent color.
 *
 * @param props - The color properties for light and dark themes.
 * @param props.light - The color to use in light theme.
 * @param props.dark - The color to use in dark theme.
 * @param colorName - The name of the color to retrieve from the theme constants.
 *
 * @returns The appropriate color based on the current theme and provided props.
 */
export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark,
) {
  const theme = useColorScheme() ?? 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}

/**
 * Themed Text component that automatically adapts to the current color scheme.
 *
 * @param props - The text properties.
 *
 * @returns The rendered themed text.
 */
export function Text(props: TextProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  return <DefaultText style={[{ color }, style]} {...otherProps} />;
}

/**
 * Themed View component that automatically adapts to the current color scheme.
 *
 * @param props - The view properties.
 *
 * @returns The rendered themed view.
 */
export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />;
}
