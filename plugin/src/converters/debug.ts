/**
 * Converter Debug Utilities
 * 
 * Provides logging and inspection tools for debugging conversions.
 * Logs to both console and file for easier debugging in Joplin.
 */

import { appendFileSync } from 'fs';
import { join } from 'path';
import { IRDocument, Paragraph, StyledSpan, ConversionDebug } from './types';

/** Whether debug mode is enabled */
let debugEnabled = false;

/** Path to debug log file */
let debugLogPath: string | null = null;

/** Debug log history */
const debugLog: ConversionDebug[] = [];

/** Maximum log entries to keep */
const maxLogEntries = 100;

/**
 * Enable or disable debug mode.
 * 
 * @param enabled - Whether to enable debug mode
 * @param logDir - Optional directory for log file (e.g., dataDir)
 */
export function setDebugMode(enabled: boolean, logDir?: string): void {
  debugEnabled = enabled;
  
  if (enabled && logDir) {
    debugLogPath = join(logDir, 'converter-debug.log');
    try {
      const header = `\n=== Converter Debug Session ===\nStarted: ${new Date().toISOString()}\n\n`;
      appendFileSync(debugLogPath, header);
    } catch {
      // Ignore file write errors
    }
  } else if (!enabled) {
    debugLogPath = null;
  }
}

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Get the debug log file path.
 */
export function getDebugLogPath(): string | null {
  return debugLogPath;
}

/**
 * Log a debug entry.
 * 
 * @param step - The conversion step name
 * @param input - Description of input
 * @param output - The output or intermediate state
 */
export function debug(step: string, input: string, output: unknown): void {
  if (!debugEnabled) return;
  
  const entry: ConversionDebug = {
    step,
    input,
    output: safeSerialize(output),
    timestamp: Date.now(),
  };
  
  debugLog.push(entry);
  
  if (debugLog.length > maxLogEntries) {
    debugLog.shift();
  }
  
  // Log to file
  if (debugLogPath) {
    try {
      const timestamp = new Date().toISOString();
      const serialized = JSON.stringify(safeSerialize(output), null, 2);
      const logEntry = `[${timestamp}] ${step} | ${input}:\n${serialized}\n\n`;
      appendFileSync(debugLogPath, logEntry);
    } catch (e) {
      // Ignore file write errors
    }
  }
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
const safeSerialize = (obj: unknown, maxDepth = 5): unknown => {
  if (maxDepth <= 0) return '[max depth]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    if (obj.length > 50) {
      return [...obj.slice(0, 10).map(o => safeSerialize(o, maxDepth - 1)), `... (${obj.length} items)`];
    }
    return obj.map(o => safeSerialize(o, maxDepth - 1));
  }
  
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = safeSerialize((obj as Record<string, unknown>)[key], maxDepth - 1);
  }
  return result;
};

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

