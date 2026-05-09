import { Text, TextProps } from './Themed';

/**
 * Text component that uses the SpaceMono font.
 *
 * @param props - The text properties.
 *
 * @returns The rendered monospace text.
 */
export function MonoText(props: TextProps) {
  return <Text {...props} style={[props.style, { fontFamily: 'SpaceMono' }]} />;
}
