/**
 * Converter Debug Utilities
 * 
 * Provides logging and inspection tools for debugging conversions.
 */

import { IRDocument, Paragraph, StyledSpan, ConversionDebug } from './types';

/** Whether debug mode is enabled */
let debugEnabled = false;

/** Debug log history */
const debugLog: ConversionDebug[] = [];

/** Maximum log entries to keep */
const MAX_LOG_ENTRIES = 100;

/**
 * Enable or disable debug mode.
 */
export function setDebugMode(enabled: boolean): void {
  debugEnabled = enabled;
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Log a debug entry.
 * 
 * @param step - The conversion step name
 * @param input - Description of input
 * @param output - The output or intermediate state
 */
export function debug(step: string, input: string, output: any): void {
  if (!debugEnabled) return;
  
  const entry: ConversionDebug = {
    step,
    input,
    output: safeSerialize(output),
    timestamp: Date.now(),
  };
  
  debugLog.push(entry);
  
  // Trim if too long
  if (debugLog.length > MAX_LOG_ENTRIES) {
    debugLog.shift();
  }
  
  // Also log to console
  console.log(`[converter:${step}] ${input}:`, output);
}

/**
 * Get the debug log.
 */
export function getDebugLog(): ConversionDebug[] {
  return [...debugLog];
}

/**
 * Clear the debug log.
 */
export function clearDebugLog(): void {
  debugLog.length = 0;
}

/**
 * Safely serialize an object for logging.
 * Handles circular references and large objects.
 */
function safeSerialize(obj: any, maxDepth = 5): any {
  if (maxDepth <= 0) return '[max depth]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    if (obj.length > 50) {
      return [...obj.slice(0, 10).map(o => safeSerialize(o, maxDepth - 1)), `... (${obj.length} items)`];
    }
    return obj.map(o => safeSerialize(o, maxDepth - 1));
  }
  
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    result[key] = safeSerialize(obj[key], maxDepth - 1);
  }
  return result;
}

/**
 * Format an IR document as a readable string for debugging.
 */
export function formatIRDocument(doc: IRDocument): string {
  const lines: string[] = [];
  
  for (let i = 0; i < doc.length; i++) {
    const para = doc[i];
    lines.push(`[${i}] ${formatParagraph(para)}`);
  }
  
  return lines.join('\n');
}

/**
 * Format a paragraph as a readable string.
 */
export function formatParagraph(para: Paragraph): string {
  const typeStr = para.type === 'heading' 
    ? `H${para.level}` 
    : para.type.toUpperCase();
  
  const spanStrs = para.spans.map(formatSpan);
  
  return `${typeStr}: ${spanStrs.join('')}`;
}

/**
 * Format a span as a readable string.
 */
export function formatSpan(span: StyledSpan): string {
  let text = span.text;
  
  // Apply style markers for visibility
  if (span.bold) text = `**${text}**`;
  if (span.italic) text = `_${text}_`;
  if (span.code) text = `\`${text}\``;
  if (span.link) text = `[${text}](${span.link})`;
  
  return text;
}

