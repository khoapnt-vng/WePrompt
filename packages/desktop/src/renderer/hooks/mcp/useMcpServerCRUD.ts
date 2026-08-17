import { useCallback } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { mcpService } from '@/common/adapter/ipcBridge';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { isReservedMcpServerName } from '@/common/config/builtinCapabilities';
import type { IMcpServer } from '@/common/config/storage';
import { toBackendMcpPayload } from './catalog';

const mergeServerState = (persisted: IMcpServer, fallback?: Partial<IMcpServer>): IMcpServer => ({
  ...persisted,
  last_test_status: fallback?.last_test_status ?? persisted.last_test_status,
  tools: fallback?.tools ?? persisted.tools,
  last_connected: fallback?.last_connected ?? persisted.last_connected,
  original_json: fallback?.original_json ?? persisted.original_json,
});

const replaceUserServer = (servers: IMcpServer[], nextServer: IMcpServer) => {
  const remainingServers = servers.filter((server) => server.builtin === true || server.id !== nextServer.id);
  const insertIndex = remainingServers.findIndex((server) => server.builtin === true);

  if (insertIndex === -1) {
    return [...remainingServers, nextServer];
  }

  remainingServers.splice(insertIndex, 0, nextServer);
  return remainingServers;
};

const getMcpRequestErrorMessage = (error: unknown, fallback: string): string => {
  if (isBackendHttpError(error) && error.backendMessage.trim()) return error.backendMessage;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
};
export const useMcpServerCRUD = (
  saveMcpServers: (serversOrUpdater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => Promise<void>
) => {
  const { t } = useTranslation();

  const persistEnabledState = useCallback(async (server: IMcpServer, enabled: boolean) => {
    if (server.enabled === enabled) {
      return server;
    }

    return mcpService.toggleServer.invoke({ id: server.id });
  }, []);

  const handleAddMcpServer = useCallback(
    async (serverData: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>) => {
      if (isReservedMcpServerName(serverData.name)) {
        Message.error(t('settings.mcpJsonReservedNameError'));
        return undefined;
      }

      try {
        let persisted = await mcpService.createServer.invoke(toBackendMcpPayload(serverData));
        persisted = await persistEnabledState(persisted, serverData.enabled);

        const nextServer = mergeServerState(persisted, serverData);
        await saveMcpServers((prevServers) => replaceUserServer(prevServers, nextServer));
        return nextServer;
      } catch (error) {
        Message.error(getMcpRequestErrorMessage(error, t('settings.mcpImportFailed')));
        return undefined;
      }
    },
    [persistEnabledState, saveMcpServers, t]
  );

  const handleBatchImportMcpServers = useCallback(
    async (serversData: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>[]) => {
      // Backstop for callers that do not go through parseMcpJsonImport (the one-click
      // importer builds its entries directly). Reserved entries are dropped rather than
      // failing the batch, matching how that importer already skips name collisions.
      const allowedServers = serversData.filter((server) => !isReservedMcpServerName(server.name));
      if (allowedServers.length !== serversData.length) {
        Message.error(t('settings.mcpJsonReservedNameError'));
      }
      if (allowedServers.length === 0) {
        return undefined;
      }

      try {
        const imported = await mcpService.importServers.invoke({
          servers: allowedServers.map((server) => toBackendMcpPayload(server)),
        });

        const finalServers: IMcpServer[] = [];
        for (const importedServer of imported) {
          const original = allowedServers.find((server) => server.name === importedServer.name);
          const persisted = await persistEnabledState(importedServer, original?.enabled ?? false);
          finalServers.push(mergeServerState(persisted, original));
        }

        await saveMcpServers((prevServers) => {
          let nextServers = prevServers.filter((server) => server.builtin === true);
          const existingUserServers = prevServers.filter((server) => server.builtin !== true);

          for (const server of existingUserServers) {
            if (!finalServers.some((next) => next.id === server.id || next.name === server.name)) {
              nextServers = [...nextServers, server];
            }
          }

          for (const server of finalServers) {
            nextServers = replaceUserServer(nextServers, server);
          }

          return nextServers;
        });

        return finalServers;
      } catch (error) {
        Message.error(getMcpRequestErrorMessage(error, t('settings.mcpImportFailed')));
        return [];
      }
    },
    [persistEnabledState, saveMcpServers, t]
  );

  const handleEditMcpServer = useCallback(
    async (
      editingMcpServer: IMcpServer | undefined,
      serverData: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>
    ): Promise<IMcpServer | undefined> => {
      if (!editingMcpServer) {
        return undefined;
      }

      // Renaming an existing server is a registration too — without this, the add-path guard
      // is trivially sidestepped by creating under a benign name and editing it afterwards.
      if (isReservedMcpServerName(serverData.name)) {
        Message.error(t('settings.mcpJsonReservedNameError'));
        return undefined;
      }

      try {
        let persisted = await mcpService.updateServer.invoke({
          id: editingMcpServer.id,
          data: toBackendMcpPayload(serverData),
        });
        persisted = await persistEnabledState(persisted, serverData.enabled);

        const nextServer = mergeServerState(persisted, {
          ...editingMcpServer,
          ...serverData,
        });
        await saveMcpServers((prevServers) =>
          prevServers.map((server) => (server.id === editingMcpServer.id ? nextServer : server))
        );

        Message.success(t('settings.mcpImportSuccess'));
        return nextServer;
      } catch (error) {
        Message.error(getMcpRequestErrorMessage(error, t('settings.mcpImportFailed')));
        return undefined;
      }
    },
    [persistEnabledState, saveMcpServers, t]
  );

  const handleDeleteMcpServer = useCallback(
    async (serverId: string) => {
      await mcpService.deleteServer.invoke({ id: serverId });
      await saveMcpServers((prevServers) => prevServers.filter((server) => server.id !== serverId));
      Message.success(t('settings.mcpDeleted'));
    },
    [saveMcpServers, t]
  );

  return {
    handleAddMcpServer,
    handleBatchImportMcpServers,
    handleEditMcpServer,
    handleDeleteMcpServer,
  };
};
