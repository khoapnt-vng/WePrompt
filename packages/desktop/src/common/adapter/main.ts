/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';

import { bridge } from '@/common/platform/bridge';
import {
  ADAPTER_BRIDGE_EVENT_KEY,
  getNativeBridgeProviderKey,
  getRendererBridgeQueryResponseKey,
} from './native/constants';
import {
  getNativeBridgePayloadDiagnostic,
  parseNativeBridgePayload,
  parseRendererBridgeQueryResponse,
} from './native/payloadSchemas';
import { registerWebSocketBroadcaster, getBridgeEmitter, setBridgeEmitter, broadcastToAll } from './registry';

type BridgeEventData = {
  name: string;
  data: unknown;
};

const adapterWindowList: Array<BrowserWindow> = [];

export { registerWebSocketBroadcaster, getBridgeEmitter };

let petNotifyHook: ((name: string, data: unknown) => void) | null = null;

export const setPetNotifyHook = (hook: ((name: string, data: unknown) => void) | null): void => {
  petNotifyHook = hook;
};

/**
 * @description 建立与每一个browserWindow的通信桥梁
 * */
/** Maximum IPC payload size (50 MB). Messages exceeding this are dropped with an error notification. */
const MAX_IPC_PAYLOAD_SIZE = 50 * 1024 * 1024;
/** Native provider calls are small except for user-theme image data. */
const MAX_INBOUND_IPC_PAYLOAD_SIZE = 16 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBridgeEventData(info: unknown): BridgeEventData {
  if (typeof info !== 'string') {
    throw new Error('[adapter] Native IPC request rejected: invalid envelope');
  }
  if (Buffer.byteLength(info, 'utf8') > MAX_INBOUND_IPC_PAYLOAD_SIZE) {
    throw new Error(`[adapter] Native IPC request rejected: payload exceeds ${MAX_INBOUND_IPC_PAYLOAD_SIZE} bytes`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(info);
  } catch {
    throw new Error('[adapter] Native IPC request rejected: malformed JSON');
  }

  if (!isRecord(parsed) || typeof parsed.name !== 'string') {
    throw new Error('[adapter] Native IPC request rejected: invalid envelope');
  }

  const rendererQueryKey = getRendererBridgeQueryResponseKey(parsed.name);
  if (rendererQueryKey) {
    if (!bridge.hasListener(parsed.name)) {
      throw new Error('[adapter] Native IPC request rejected: operation is not allowed');
    }
    return {
      name: parsed.name,
      data: parseRendererBridgeQueryResponse(rendererQueryKey, parsed.data),
    };
  }

  if (parsed.name.startsWith('subscribe.callback-')) {
    throw new Error('[adapter] Native IPC request rejected: operation is not allowed');
  }

  if (!isRecord(parsed.data)) {
    throw new Error('[adapter] Native IPC request rejected: invalid envelope');
  }
  if (typeof parsed.data.id !== 'string' || parsed.data.id.length === 0 || parsed.data.id.length > 256) {
    throw new Error('[adapter] Native IPC request rejected: invalid envelope');
  }
  const providerKey = getNativeBridgeProviderKey(parsed.name);
  if (!providerKey) {
    throw new Error('[adapter] Native IPC request rejected: operation is not allowed');
  }

  let validatedPayload: unknown;
  try {
    validatedPayload = parseNativeBridgePayload(providerKey, parsed.data.data);
  } catch (error) {
    const diagnostic = getNativeBridgePayloadDiagnostic(error);
    if (diagnostic !== null) {
      try {
        console.error(`[adapter] Native IPC payload validation failed ${JSON.stringify(diagnostic)}`);
      } catch {
        // A diagnostic sink must never replace the generic IPC rejection.
      }
    }
    throw error;
  }

  return {
    name: parsed.name,
    data: {
      id: parsed.data.id,
      ...(validatedPayload !== undefined ? { data: validatedPayload } : {}),
    },
  };
}

function isRegisteredAdapterSender(sender: IpcMainInvokeEvent['sender']): boolean {
  for (let i = adapterWindowList.length - 1; i >= 0; i--) {
    const win = adapterWindowList[i];
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      adapterWindowList.splice(i, 1);
      continue;
    }
    if (win.webContents === sender) return true;
  }
  return false;
}

bridge.adapter({
  emit(name, data) {
    // Notify pet (if hook is set)
    if (petNotifyHook) {
      try {
        petNotifyHook(name, data);
      } catch {
        /* never crash */
      }
    }

    // 1. Send to all Electron BrowserWindows (skip destroyed ones)
    let serialized: string;
    try {
      serialized = JSON.stringify({ name, data });
    } catch (error) {
      // RangeError: Invalid string length — data too large to serialize
      console.error('[adapter] Failed to serialize bridge event:', name, error);
      return;
    }

    // Guard: reject oversized payloads to prevent main-process blocking
    if (serialized.length > MAX_IPC_PAYLOAD_SIZE) {
      console.error(
        `[adapter] Bridge event "${name}" too large (${(serialized.length / 1024 / 1024).toFixed(1)}MB), skipped`
      );
      const errorPayload = JSON.stringify({
        name: 'bridge:error',
        data: { originalEvent: name, reason: 'payload_too_large', size: serialized.length },
      });
      for (let i = adapterWindowList.length - 1; i >= 0; i--) {
        const win = adapterWindowList[i];
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(ADAPTER_BRIDGE_EVENT_KEY, errorPayload);
        }
      }
      return;
    }

    for (let i = adapterWindowList.length - 1; i >= 0; i--) {
      const win = adapterWindowList[i];
      if (win.isDestroyed() || win.webContents.isDestroyed()) {
        adapterWindowList.splice(i, 1);
        continue;
      }
      win.webContents.send(ADAPTER_BRIDGE_EVENT_KEY, serialized);
    }
    // 2. Also broadcast to all WebSocket clients
    broadcastToAll(name, data);
  },
  on(emitter) {
    // 保存 emitter 引用供 WebSocket 处理使用 / Save emitter reference for WebSocket handling
    setBridgeEmitter(emitter);

    ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, async (event, info: unknown) => {
      if (!isRegisteredAdapterSender(event.sender)) {
        throw new Error('[adapter] Native IPC request rejected: sender is not registered');
      }
      const { name, data } = parseBridgeEventData(info);
      return emitter.emit(name, data);
    });
  },
});

export const initMainAdapterWithWindow = (win: BrowserWindow) => {
  adapterWindowList.push(win);
  const off = () => {
    const index = adapterWindowList.indexOf(win);
    if (index > -1) adapterWindowList.splice(index, 1);
  };
  win.on('closed', off);
  return off;
};
