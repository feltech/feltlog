import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { darkTheme, getAppTheme, lightTheme, type ThemeMode } from '../appTheme';

describe('appTheme', () => {
  describe('lightTheme', () => {
    it('is a light theme', () => {
      expect(lightTheme.dark).toBe(false);
    });

    it('maps navigation colors onto the Paper light palette', () => {
      expect(lightTheme.colors.primary).toBe(MD3LightTheme.colors.primary);
      expect(lightTheme.colors.background).toBe(MD3LightTheme.colors.background);
      expect(lightTheme.colors.card).toBe(MD3LightTheme.colors.surface);
      expect(lightTheme.colors.text).toBe(MD3LightTheme.colors.onBackground);
      expect(lightTheme.colors.border).toBe(MD3LightTheme.colors.outline);
      expect(lightTheme.colors.notification).toBe(MD3LightTheme.colors.error);
    });

    it('provides navigation-compatible fonts', () => {
      expect(lightTheme.fonts.regular).toEqual({
        fontFamily: 'Roboto',
        fontWeight: '400',
      });
      expect(lightTheme.fonts.medium).toEqual({
        fontFamily: 'Roboto',
        fontWeight: '500',
      });
      expect(lightTheme.fonts.bold).toEqual({
        fontFamily: 'Roboto',
        fontWeight: '700',
      });
      expect(lightTheme.fonts.heavy).toEqual({
        fontFamily: 'Roboto',
        fontWeight: '900',
      });
    });
  });

  describe('darkTheme', () => {
    it('is a dark theme', () => {
      expect(darkTheme.dark).toBe(true);
    });

    it('maps navigation colors onto the Paper dark palette', () => {
      expect(darkTheme.colors.primary).toBe(MD3DarkTheme.colors.primary);
      expect(darkTheme.colors.background).toBe(MD3DarkTheme.colors.background);
      expect(darkTheme.colors.card).toBe(MD3DarkTheme.colors.surface);
      expect(darkTheme.colors.text).toBe(MD3DarkTheme.colors.onBackground);
      expect(darkTheme.colors.border).toBe(MD3DarkTheme.colors.outline);
      expect(darkTheme.colors.notification).toBe(MD3DarkTheme.colors.error);
    });

    it('provides navigation-compatible fonts', () => {
      expect(darkTheme.fonts.regular).toEqual({
        fontFamily: 'Roboto',
        fontWeight: '400',
      });
      expect(darkTheme.fonts.medium).toEqual({
        fontFamily: 'Roboto',
        fontWeight: '500',
      });
      expect(darkTheme.fonts.bold).toEqual({
        fontFamily: 'Roboto',
        fontWeight: '700',
      });
      expect(darkTheme.fonts.heavy).toEqual({
        fontFamily: 'Roboto',
        fontWeight: '900',
      });
    });
  });

  describe('getAppTheme', () => {
    it('returns lightTheme for light scheme', () => {
      expect(getAppTheme('light')).toBe(lightTheme);
    });

    it('returns darkTheme for dark scheme', () => {
      expect(getAppTheme('dark')).toBe(darkTheme);
    });

    it('defaults to lightTheme for null scheme', () => {
      expect(getAppTheme(null)).toBe(lightTheme);
    });

    it('defaults to lightTheme for unspecified scheme', () => {
      expect(getAppTheme('unspecified')).toBe(lightTheme);
    });
  });

  describe('ThemeMode re-export', () => {
    it('accepts valid theme mode values', () => {
      const modes: ThemeMode[] = ['auto', 'light', 'dark'];
      expect(modes).toEqual(['auto', 'light', 'dark']);
    });
  });
});
