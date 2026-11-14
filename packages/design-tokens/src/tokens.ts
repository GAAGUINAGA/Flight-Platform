/**
 * Tokens de diseño de la marca PROVISIONAL (diseño F12c-0 §2.2). ÚNICA fuente de colores, tipografía, espaciado, radios,
 * sombras y cortes: la web los consume como variables CSS (`tokens.css`, generado) y React Native como este objeto.
 * Para cambiar la marca se edita este archivo y se regenera (`npm run build -w @flight-platform/design-tokens`): ver §2.3.
 * Sin dependencias ni APIs de plataforma.
 */
export const tokens = {
  color: {
    // Marca
    primary: '#0B2A5B',
    primaryHover: '#123B7A',
    primarySoft: '#1B3F7A',
    onPrimary: '#FFFFFF',
    onPrimaryMuted: '#D5DEEE',
    accent: '#C2410C',
    accentHover: '#9A3412',
    onAccent: '#FFFFFF',
    // Superficies y texto
    background: '#FFFFFF',
    surfaceSoft: '#EEF3FB',
    neutral: '#F6F7F9',
    line: '#D9DEE7',
    lineStrong: '#768196',
    text: '#14213D',
    textMuted: '#5B6678',
    link: '#0B4FB3',
    focus: '#175CD3',
    // Estados (texto sobre su fondo suave ≥ 4,5:1)
    success: '#067647',
    successSoft: '#ECFDF3',
    warning: '#B54708',
    warningSoft: '#FEF0C7',
    error: '#B42318',
    errorSoft: '#FEF3F2',
    info: '#175CD3',
    infoSoft: '#EFF8FF',
    // Asientos (el estado nunca se comunica solo por color)
    seatFree: '#EEF3FB',
    seatFreeBorder: '#768196',
    seatHeld: '#FEF0C7',
    seatHeldBorder: '#B54708',
    seatOccupied: '#E4E7EC',
    seatOccupiedBorder: '#768196',
    seatChosen: '#0B2A5B',
    // Capas
    overlay: 'rgba(11, 42, 91, 0.55)',
    heroScrimTop: 'rgba(11, 42, 91, 0.60)',
    heroScrimBottom: 'rgba(11, 42, 91, 0.20)'
  },
  font: {
    family: "'Inter', system-ui, Arial, sans-serif",
    size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 28, display: 32 },
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
    lineHeight: { tight: 1.25, normal: 1.5 }
  },
  space: { s1: 4, s2: 8, s3: 12, s4: 16, s6: 24, s8: 32, s12: 48 },
  radius: { sm: 4, md: 8, lg: 12, pill: 999 },
  shadow: {
    card: '0 1px 3px rgba(20, 33, 61, 0.10)',
    raised: '0 8px 24px rgba(20, 33, 61, 0.14)'
  },
  size: { container: 1200, control: 48, controlSmall: 40, header: 72 },
  breakpoint: { sm: 640, md: 960, lg: 1200 }
} as const;

export type Tokens = typeof tokens;
/** Tamaño mínimo de texto permitido (accesibilidad: nada por debajo de 12 px). */
export const MIN_FONT_SIZE = 12;
