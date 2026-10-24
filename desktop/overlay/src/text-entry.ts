/**
 * Entry for the DOM-free bundle that Swift runs in JavaScriptCore:
 * `SpiderText.extract(text, configJson)` returns the result as a JSON string.
 * `configJson` is `{detectors, custom}`, the shape `CrawlSettings` already emits.
 */

import {DEFAULT_CONFIG, type DetectorConfig} from './detectors';
import {extractFromText} from './text-extract';

function extract(text: string, configJson: string): string {
  const parsed = JSON.parse(configJson) as Partial<DetectorConfig>;
  const config: DetectorConfig = {
    detectors: {...DEFAULT_CONFIG.detectors, ...parsed.detectors},
    custom: parsed.custom ?? '',
  };
  return JSON.stringify(extractFromText(text, config));
}

(globalThis as unknown as {SpiderText: {extract: typeof extract}}).SpiderText = {extract};
