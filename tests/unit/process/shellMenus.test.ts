import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: unknown) => ({ template })),
  setApplicationMenu: vi.fn(),
  updateOpenEmit: vi.fn(),
}));

const appMock = {
  name: 'WePrompt',
  isPackaged: true,
  dock: { hide: vi.fn(), show: vi.fn() },
  relaunch: vi.fn(),
  exit: vi.fn(),
  quit: vi.fn(),
};

const menuMock = {
  buildFromTemplate: mocks.buildFromTemplate,
  setApplicationMenu: mocks.setApplicationMenu,
};

const originalEnvironment = {
  WEPROMPT_UPDATE_BASE_URL: process.env.WEPROMPT_UPDATE_BASE_URL,
  AIONUI_DISABLE_AUTO_UPDATE: process.env.AIONUI_DISABLE_AUTO_UPDATE,
  AIONUI_E2E_TEST: process.env.AIONUI_E2E_TEST,
  CI: process.env.CI,
  GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
};

const restoreEnvironment = () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

vi.mock('electron', () => ({
  app: appMock,
  Menu: menuMock,
}));

vi.mock('@/common/electronSafe', () => ({
  electronApp: appMock,
  electronMenu: menuMock,
  electronNativeImage: {
    createFromPath: vi.fn(() => ({ resize: vi.fn(() => ({})) })),
  },
  electronTray: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: vi.fn().mockResolvedValue({ items: [] }) },
    },
    update: {
      open: { emit: mocks.updateOpenEmit },
    },
  },
}));

vi.mock('@/common/config/constants', () => ({
  DESKTOP_PET_ENABLED: false,
}));

vi.mock('@/process/services/i18n', () => ({
  default: { t: (key: string) => key },
}));

type MenuItem = {
  label?: string;
  submenu?: MenuItem[];
};

function menuLabels(template: MenuItem[]): string[] {
  return template
    .flatMap((item) => [item.label, ...(item.submenu ? menuLabels(item.submenu) : [])])
    .filter((label): label is string => Boolean(label));
}

describe('update actions in application and tray menus', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.WEPROMPT_UPDATE_BASE_URL;
    delete process.env.AIONUI_DISABLE_AUTO_UPDATE;
    delete process.env.AIONUI_E2E_TEST;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
  });

  afterEach(() => {
    restoreEnvironment();
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
  });

  async function buildBothMenus(): Promise<{ applicationLabels: string[]; trayLabels: string[] }> {
    const { setupApplicationMenu } = await import('@/process/utils/appMenu');
    setupApplicationMenu();
    const applicationTemplate = mocks.buildFromTemplate.mock.calls.at(-1)?.[0] as MenuItem[];

    const trayModule = (await import('@/process/utils/tray')) as typeof import('@/process/utils/tray') & {
      buildTrayContextMenu: () => Promise<unknown>;
    };
    expect(trayModule.buildTrayContextMenu).toBeTypeOf('function');
    await trayModule.buildTrayContextMenu();
    const trayTemplate = mocks.buildFromTemplate.mock.calls.at(-1)?.[0] as MenuItem[];

    return {
      applicationLabels: menuLabels(applicationTemplate),
      trayLabels: menuLabels(trayTemplate),
    };
  }

  it('omits update actions when no product-owned feed is configured', async () => {
    const labels = await buildBothMenus();

    expect(labels.applicationLabels).not.toContain('common.tray.checkUpdate');
    expect(labels.trayLabels).not.toContain('common.tray.checkUpdate');
  });

  it('exposes update actions only with a valid future WePrompt feed', async () => {
    process.env.WEPROMPT_UPDATE_BASE_URL = 'https://updates.weprompt.test/releases';

    const labels = await buildBothMenus();

    expect(labels.applicationLabels).toContain('common.tray.checkUpdate');
    expect(labels.trayLabels).toContain('common.tray.checkUpdate');
  });
});
