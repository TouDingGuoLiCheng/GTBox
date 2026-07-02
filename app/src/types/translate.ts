export interface TranslateSettings {
  targetLang: string;
  primaryProvider: string;
  fallbackEnabled: boolean;
  timeoutSec: number;
  cacheTtlSec: number;
  historyMaxCount: number;
}

export interface TranslateResult {
  ok: boolean;
  sourceText: string;
  translatedText?: string;
  provider?: string;
  fromCache: boolean;
  error?: string;
  durationMs: number;
}

export interface HistoryRecord {
  id: string;
  createdAt: number;
  sourceText: string;
  translatedText?: string;
  ok: boolean;
  error?: string;
  provider?: string;
  fromCache: boolean;
  durationMs: number;
}

export interface TranslatorProviderMeta {
  id: string;
  name: string;
  enabled: boolean;
}

export interface TranslatorsFile {
  version: number;
  providers: TranslatorProviderMeta[];
}
