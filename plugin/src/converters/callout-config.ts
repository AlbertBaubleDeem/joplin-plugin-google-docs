/**
 * Callout Box Configuration
 * 
 * Defines the styling for callout boxes (note, info, question, warning, jarvis, tip)
 * matching the Joplin custom CSS styling.
 */

import { CalloutType } from './types';

/**
 * Callout definition with color and symbol.
 */
export type CalloutDefinition = {
  /** The callout type identifier */
  type: CalloutType;
  /** Hex color for border and symbol background */
  color: string;
  /** RGB color for Google Docs API (0-1 range) */
  rgbColor: { red: number; green: number; blue: number };
  /** Symbol character displayed in the left cell */
  symbol: string;
};

/**
 * Convert hex color to RGB (0-1 range for Google Docs API).
 */
const hexToRgb = (hex: string): { red: number; green: number; blue: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { red: 0, green: 0, blue: 0 };
  }
  return {
    red: parseInt(result[1], 16) / 255,
    green: parseInt(result[2], 16) / 255,
    blue: parseInt(result[3], 16) / 255,
  };
};

/**
 * All supported callout types with their styling.
 */
export const calloutDefinitions: CalloutDefinition[] = [
  {
    type: 'note',
    color: '#02A4F1',
    rgbColor: hexToRgb('#02A4F1'),
    symbol: '\u270E', // ✎
  },
  {
    type: 'info',
    color: '#E7AE1D',
    rgbColor: hexToRgb('#E7AE1D'),
    symbol: '\u2139', // ℹ
  },
  {
    type: 'question',
    color: '#F459F4',
    rgbColor: hexToRgb('#F459F4'),
    symbol: '?',
  },
  {
    type: 'warning',
    color: '#FF1744',
    rgbColor: hexToRgb('#FF1744'),
    symbol: '\u26A0', // ⚠
  },
  {
    type: 'jarvis',
    color: '#6A5ACD',
    rgbColor: hexToRgb('#6A5ACD'),
    symbol: '\u{1F916}', // 🤖
  },
  {
    type: 'tip',
    color: '#4CAF50',
    rgbColor: hexToRgb('#4CAF50'),
    symbol: '\u{1F4A1}', // 💡
  },
];

export const calloutByType: Record<CalloutType, CalloutDefinition> = 
  calloutDefinitions.reduce((acc, def) => {
    acc[def.type] = def;
    return acc;
  }, {} as Record<CalloutType, CalloutDefinition>);

export const calloutBySymbol: Record<string, CalloutType> = 
  calloutDefinitions.reduce((acc, def) => {
    acc[def.symbol] = def.type;
    return acc;
  }, {} as Record<string, CalloutType>);

export const calloutTypeNames: CalloutType[] = calloutDefinitions.map(d => d.type);

/** Matches: <note>, <info>, <question>, <warning>, <jarvis>, <tip> */
export const calloutOpenTagRegex = new RegExp(
  `<(${calloutTypeNames.join('|')})>`,
  'gi'
);

export function getCalloutDefinition(type: CalloutType): CalloutDefinition | undefined {
  return calloutByType[type];
}

export function getCalloutTypeBySymbol(symbol: string): CalloutType | undefined {
  return calloutBySymbol[symbol];
}

/**
 * Check if a color matches a callout color (with tolerance for floating point).
 */
export function matchCalloutByColor(
  rgb: { red: number; green: number; blue: number }
): CalloutType | undefined {
  const tolerance = 0.05;
  
  for (const def of calloutDefinitions) {
    const dr = Math.abs(rgb.red - def.rgbColor.red);
    const dg = Math.abs(rgb.green - def.rgbColor.green);
    const db = Math.abs(rgb.blue - def.rgbColor.blue);
    
    if (dr < tolerance && dg < tolerance && db < tolerance) {
      return def.type;
    }
  }
  
  return undefined;
}

