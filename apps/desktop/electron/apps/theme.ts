import { CHART_THEMES } from '@dalliance/shared/chart-theme'
import interFont from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline'
import monoFont from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?inline'

/** Native Streamlit theme pairs follow prefers-color-scheme without reloading an app session. */
export function dallianceAppTheme(): Record<string, unknown> {
  const options: Record<string, unknown> = {
    'theme.font': 'Inter, sans-serif', 'theme.headingFont': 'Inter, sans-serif', 'theme.codeFont': 'JetBrains Mono, monospace',
    'theme.fontFaces': [{ family: 'Inter', url: interFont, weight: '100 900' }, { family: 'JetBrains Mono', url: monoFont, weight: '100 800' }],
    'theme.baseFontSize': 14, 'theme.baseFontWeight': 400,
    'theme.headingFontSizes': ['1.85rem', '1.4rem', '1.15rem'], 'theme.headingFontWeights': [550, 500, 500],
    'theme.metricValueFontSize': '2rem', 'theme.metricValueFontWeight': 500,
  }
  for (const mode of ['light', 'dark'] as const) {
    const chart = CHART_THEMES[mode]
    const theme = {
      primaryColor: mode === 'light' ? '#1f3b2d' : '#7fbf93', backgroundColor: chart.background,
      secondaryBackgroundColor: mode === 'light' ? '#f3f2ef' : '#252523', textColor: chart.foreground,
      borderColor: chart.grid, showWidgetBorder: true, baseRadius: '0.625rem', buttonRadius: '0.5rem',
      chartCategoricalColors: chart.colors,
    }
    for (const [key, value] of Object.entries(theme)) options[`theme.${mode}.${key}`] = value
  }
  return options
}
