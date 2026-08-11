import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveLocaleKey } from '@/common/utils';
import { useConversationAssistants } from '@renderer/pages/conversation/hooks/useConversationAssistants';
import {
  assistantToOption,
  filterTeamSupportedAssistants,
  teamAssistantMatchesQuery,
  type TeamAssistantOption,
} from '../components/assistantSelectUtils';

export function useTeamAssistantOptions(locale = 'en-US'): {
  assistants: TeamAssistantOption[];
  loading: boolean;
  error: unknown;
  filterByQuery: (query: string) => TeamAssistantOption[];
} {
  const { t } = useTranslation();
  const result = useConversationAssistants() as {
    presetAssistants?: Parameters<typeof assistantToOption>[0][];
    loading?: boolean;
    isLoading?: boolean;
    error?: unknown;
  };
  const localeKey = resolveLocaleKey(locale);
  const assistants = useMemo(
    () =>
      filterTeamSupportedAssistants(
        (result.presetAssistants ?? []).map((assistant) => assistantToOption(assistant, localeKey))
      ),
    [result.presetAssistants, localeKey]
  );
  const filterByQuery = useMemo(
    () => (query: string) => assistants.filter((assistant) => teamAssistantMatchesQuery(assistant, query, t)),
    [assistants, t]
  );

  return {
    assistants,
    loading: Boolean(result.loading ?? result.isLoading),
    error: result.error,
    filterByQuery,
  };
}
