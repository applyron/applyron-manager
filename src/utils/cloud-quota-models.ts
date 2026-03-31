import type { CloudQuotaModelInfo } from '@/types/cloudAccount';
import { roundQuotaPercentage } from '@/utils/quota-display';

export interface CanonicalQuotaModel {
  id: string;
  displayName: string;
  percentage: number;
  resetTime: string;
}

export interface CanonicalQuotaSummary {
  geminiModels: CanonicalQuotaModel[];
  claudeModels: CanonicalQuotaModel[];
  visibleModelCount: number;
  overallPercentage: number | null;
}

export const GEMINI_PRO_COMBINED_MODEL_ID = 'gemini-3.1-pro-low/high';

const GEMINI_LEGACY_MODEL_PATTERN = /gemini-[12](\.|$|-)/i;

const MODEL_DISPLAY_REPLACEMENTS: Array<[string, string]> = [
  [GEMINI_PRO_COMBINED_MODEL_ID, 'Gemini 3.1 Pro (Low/High)'],
  ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'],
  ['gemini-3-pro-image', 'Gemini 3 Pro Image'],
  ['gemini-3.1-pro', 'Gemini 3.1 Pro'],
  ['gemini-3-pro', 'Gemini 3 Pro'],
  ['gemini-3-flash', 'Gemini 3 Flash'],
  ['claude-sonnet-4-6-thinking', 'Claude 4.6 Sonnet (Thinking)'],
  ['claude-sonnet-4-6', 'Claude 4.6 Sonnet'],
  ['claude-sonnet-4-5-thinking', 'Claude 4.5 Sonnet (Thinking)'],
  ['claude-sonnet-4-5', 'Claude 4.5 Sonnet'],
  ['claude-opus-4-6-thinking', 'Claude 4.6 Opus (Thinking)'],
  ['claude-opus-4-5-thinking', 'Claude 4.5 Opus (Thinking)'],
  ['claude-3-5-sonnet', 'Claude 3.5 Sonnet'],
];

function isGeminiProLowModel(modelName: string): boolean {
  return modelName.toLowerCase().includes('gemini-3.1-pro-low');
}

function isGeminiProHighModel(modelName: string): boolean {
  return modelName.toLowerCase().includes('gemini-3.1-pro-high');
}

export function isSupportedQuotaModelId(modelName: string): boolean {
  return (
    (modelName.includes('gemini') && !GEMINI_LEGACY_MODEL_PATTERN.test(modelName)) ||
    modelName.includes('claude')
  );
}

function formatQuotaModelDisplayNameFromId(modelName: string): string {
  let displayName = modelName.replace('models/', '');
  for (const [source, target] of MODEL_DISPLAY_REPLACEMENTS) {
    displayName = displayName.replace(source, target);
  }

  return displayName
    .replace(/-/g, ' ')
    .split(' ')
    .map((word) => (word.length > 2 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function formatQuotaModelDisplayName(
  modelName: string,
  displayName?: string | null,
): string {
  const normalizedDisplayName = displayName?.trim();
  if (normalizedDisplayName) {
    return normalizedDisplayName;
  }

  return formatQuotaModelDisplayNameFromId(modelName);
}

export function getCanonicalVisibleQuotaModels(
  models: Record<string, CloudQuotaModelInfo> | undefined,
  visibilitySettings: Record<string, boolean>,
): CanonicalQuotaModel[] {
  const visibleEntries = Object.entries(models ?? {}).filter(
    ([modelName]) => visibilitySettings[modelName] !== false,
  );

  const mergedModels: Record<string, CloudQuotaModelInfo> = {};
  const hasProLowModel = visibleEntries.some(([modelName]) => isGeminiProLowModel(modelName));
  const hasProHighModel = visibleEntries.some(([modelName]) => isGeminiProHighModel(modelName));
  const proLowModelInfo = visibleEntries.find(([modelName]) => isGeminiProLowModel(modelName))?.[1];

  for (const [modelName, modelInfo] of visibleEntries) {
    if (isGeminiProLowModel(modelName) && hasProHighModel) {
      continue;
    }

    if (isGeminiProHighModel(modelName) && hasProLowModel) {
      const mergedPercentage = proLowModelInfo
        ? Math.min(modelInfo.percentage, proLowModelInfo.percentage)
        : modelInfo.percentage;
      mergedModels[GEMINI_PRO_COMBINED_MODEL_ID] = {
        ...modelInfo,
        percentage: mergedPercentage,
        display_name: MODEL_DISPLAY_REPLACEMENTS[0][1],
      };
      continue;
    }

    mergedModels[modelName] = modelInfo;
  }

  return Object.entries(mergedModels)
    .filter(([modelName]) => isSupportedQuotaModelId(modelName))
    .map(([modelName, modelInfo]) => ({
      id: modelName,
      displayName: formatQuotaModelDisplayName(modelName, modelInfo.display_name),
      percentage: modelInfo.percentage,
      resetTime: modelInfo.resetTime,
    }));
}

export function summarizeCanonicalQuotaModels(
  models: CanonicalQuotaModel[],
): CanonicalQuotaSummary {
  const geminiModels = models
    .filter((model) => model.id.includes('gemini'))
    .sort((a, b) => b.percentage - a.percentage);
  const claudeModels = models
    .filter((model) => model.id.includes('claude'))
    .sort((a, b) => b.percentage - a.percentage);

  if (models.length === 0) {
    return {
      geminiModels,
      claudeModels,
      visibleModelCount: 0,
      overallPercentage: null,
    };
  }

  const averagePercentage =
    models.reduce((sum, model) => sum + model.percentage, 0) / models.length;

  return {
    geminiModels,
    claudeModels,
    visibleModelCount: models.length,
    overallPercentage: roundQuotaPercentage(averagePercentage),
  };
}
