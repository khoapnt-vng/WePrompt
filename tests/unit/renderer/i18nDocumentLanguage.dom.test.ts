import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type LanguageChangedHandler = (language: string) => void | Promise<void>;
type MainLanguageChangedHandler = (payload: { language: string }) => void | Promise<void>;

const i18nHarness = vi.hoisted(() => {
  const resourceBundles = new Set<string>();
  const languageChangedHandlers: LanguageChangedHandler[] = [];
  let initError: Error | null = null;
  let changeLanguageError: Error | null = null;

  const instance = {
    language: 'en-US',
    use: vi.fn(),
    init: vi.fn(),
    on: vi.fn(),
    hasResourceBundle: vi.fn(),
    addResourceBundle: vi.fn(),
    changeLanguage: vi.fn(),
  };

  instance.use.mockImplementation(() => instance);
  instance.init.mockImplementation(
    async (options: { lng: string; resources: Record<string, unknown> }): Promise<void> => {
      instance.language = options.lng;
      for (const language of Object.keys(options.resources)) resourceBundles.add(language);
      if (initError) throw initError;
    }
  );
  instance.on.mockImplementation((event: string, handler: LanguageChangedHandler) => {
    if (event === 'languageChanged') languageChangedHandlers.push(handler);
    return instance;
  });
  instance.hasResourceBundle.mockImplementation((language: string) => resourceBundles.has(language));
  instance.addResourceBundle.mockImplementation((language: string) => {
    resourceBundles.add(language);
  });
  instance.changeLanguage.mockImplementation(async (language: string): Promise<void> => {
    if (changeLanguageError) throw changeLanguageError;
    instance.language = language;
    await Promise.all(languageChangedHandlers.map((handler) => handler(language)));
  });

  return {
    instance,
    languageChangedHandlers,
    resourceBundles,
    reset(): void {
      instance.language = 'en-US';
      initError = null;
      changeLanguageError = null;
      languageChangedHandlers.length = 0;
      resourceBundles.clear();
      for (const mock of [
        instance.use,
        instance.init,
        instance.on,
        instance.hasResourceBundle,
        instance.addResourceBundle,
        instance.changeLanguage,
      ]) {
        mock.mockClear();
      }
    },
    failInit(error: Error): void {
      initError = error;
    },
    failChangeLanguage(error: Error): void {
      changeLanguageError = error;
    },
  };
});

const configHarness = vi.hoisted(() => ({
  whenReady: vi.fn<() => Promise<void>>(),
  get: vi.fn<(key: string) => string | undefined>(),
  set: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

const ipcHarness = vi.hoisted(() => {
  let languageChangedHandler: MainLanguageChangedHandler | undefined;
  const on = vi.fn((handler: MainLanguageChangedHandler) => {
    languageChangedHandler = handler;
  });
  const invoke = vi.fn<({ language }: { language: string }) => Promise<void>>(() => Promise.resolve());
  return {
    on,
    invoke,
    getLanguageChangedHandler(): MainLanguageChangedHandler {
      if (!languageChangedHandler) throw new Error('languageChanged handler was not registered');
      return languageChangedHandler;
    },
    reset(): void {
      languageChangedHandler = undefined;
      on.mockClear();
      invoke.mockReset();
      invoke.mockResolvedValue(undefined);
    },
  };
});

vi.mock('i18next', () => ({ default: i18nHarness.instance }));
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty' } }));
vi.mock('@/common/config/configService', () => ({
  configService: {
    whenReady: () => configHarness.whenReady(),
    get: (key: string) => configHarness.get(key),
    set: (key: string, value: string) => configHarness.set(key, value),
  },
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    systemSettings: {
      languageChanged: { on: ipcHarness.on },
      changeLanguage: { invoke: ipcHarness.invoke },
    },
  },
}));

const NEVER_READY = new Promise<void>(() => {});

function setNavigatorLanguage(language: string): void {
  Object.defineProperty(window.navigator, 'language', { configurable: true, value: language });
}

async function importRendererI18n() {
  return import('@renderer/services/i18n');
}

describe('renderer i18n runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    i18nHarness.reset();
    ipcHarness.reset();
    configHarness.whenReady.mockReset();
    configHarness.whenReady.mockReturnValue(NEVER_READY);
    configHarness.get.mockReset();
    configHarness.get.mockReturnValue(undefined);
    configHarness.set.mockReset();
    configHarness.set.mockResolvedValue(undefined);
    localStorage.clear();
    delete window.__initialLanguage;
    delete (window as Window & { __backendStartupFailed?: boolean }).__backendStartupFailed;
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {}, writable: true });
    setNavigatorLanguage('en-US');
    document.documentElement.removeAttribute('lang');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('initial language hints', () => {
    it('prefers the local-storage hint during a normal startup and loads it synchronously', async () => {
      localStorage.setItem('i18nextLng', 'de-DE');
      window.__initialLanguage = 'tr-TR';

      await importRendererI18n();

      expect(document.documentElement.lang).toBe('de-DE');
      expect(i18nHarness.instance.init).toHaveBeenCalledWith(
        expect.objectContaining({
          lng: 'de-DE',
          resources: expect.objectContaining({ 'en-US': expect.anything(), 'de-DE': expect.anything() }),
        })
      );
    });

    it('uses a non-blank injected hint when local storage has no preference', async () => {
      window.__initialLanguage = 'fa_IR';

      await importRendererI18n();

      expect(document.documentElement.lang).toBe('fa-IR');
    });

    it('uses startup-failure hints in injected, stored, then Electron-system order', async () => {
      (window as Window & { __backendStartupFailed?: boolean }).__backendStartupFailed = true;
      window.__initialLanguage = 'tr-TR';
      localStorage.setItem('i18nextLng', 'de-DE');
      setNavigatorLanguage('fa-IR');

      await importRendererI18n();
      expect(document.documentElement.lang).toBe('tr-TR');

      vi.resetModules();
      i18nHarness.reset();
      window.__initialLanguage = '   ';
      await importRendererI18n();
      expect(document.documentElement.lang).toBe('de-DE');

      vi.resetModules();
      i18nHarness.reset();
      localStorage.clear();
      await importRendererI18n();
      expect(document.documentElement.lang).toBe('fa-IR');
    });

    it('falls back to English when no usable hint exists', async () => {
      window.__initialLanguage = '';
      Object.defineProperty(window, 'electronAPI', {
        configurable: true,
        value: undefined,
        writable: true,
      });
      setNavigatorLanguage('xx-Unknown');

      await importRendererI18n();

      expect(document.documentElement.lang).toBe('en-US');
      expect(i18nHarness.instance.init).toHaveBeenCalledWith(
        expect.objectContaining({ lng: 'en-US', resources: { 'en-US': expect.anything() } })
      );
    });

    it('falls back to English after a failed startup with an empty Electron system hint', async () => {
      (window as Window & { __backendStartupFailed?: boolean }).__backendStartupFailed = true;
      window.__initialLanguage = ' ';
      setNavigatorLanguage('');

      await importRendererI18n();

      expect(document.documentElement.lang).toBe('en-US');
    });
  });

  describe('authoritative configuration', () => {
    it('loads, publishes, and caches the configured language after readiness', async () => {
      configHarness.whenReady.mockResolvedValue(undefined);
      configHarness.get.mockReturnValue('de-DE');

      const module = await importRendererI18n();

      await vi.waitFor(() => expect(document.documentElement.lang).toBe('de-DE'));
      expect(i18nHarness.instance.addResourceBundle).toHaveBeenCalledWith(
        'de-DE',
        'translation',
        expect.any(Object),
        true,
        true
      );
      expect(i18nHarness.instance.changeLanguage).toHaveBeenCalledWith('de-DE');
      expect(localStorage.getItem('i18nextLng')).toBe('de-DE');
      expect(module.getLoadedLanguages()).toEqual(['en-US', 'de-DE']);
    });

    it('uses the normalized system language when configuration is empty', async () => {
      configHarness.whenReady.mockResolvedValue(undefined);
      configHarness.get.mockReturnValue(undefined);
      setNavigatorLanguage('pt-PT');

      await importRendererI18n();

      await vi.waitFor(() => expect(i18nHarness.instance.changeLanguage).toHaveBeenCalledWith('pt-BR'));
      expect(localStorage.getItem('i18nextLng')).toBe('pt-BR');
    });

    it('uses the default when neither configuration nor the system reports a language', async () => {
      configHarness.whenReady.mockResolvedValue(undefined);
      configHarness.get.mockReturnValue(undefined);
      setNavigatorLanguage('');

      await importRendererI18n();

      await vi.waitFor(() => expect(i18nHarness.instance.changeLanguage).toHaveBeenCalledWith('en-US'));
      expect(localStorage.getItem('i18nextLng')).toBe('en-US');
    });

    it('reports readiness failures without dropping the initial language', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      configHarness.whenReady.mockRejectedValue(new Error('backend unavailable'));

      await importRendererI18n();

      await vi.waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith('Failed to initialize language:', expect.any(Error))
      );
      expect(document.documentElement.lang).toBe('en-US');
    });

    it('reports an i18next initialization rejection', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      i18nHarness.failInit(new Error('bad resources'));

      await importRendererI18n();

      await vi.waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith('Failed to initialize i18n:', expect.any(Error))
      );
    });
  });

  describe('languageChanged events', () => {
    it('publishes an already-loaded language without loading it again', async () => {
      await importRendererI18n();
      const handler = i18nHarness.languageChangedHandlers[0];

      await handler?.('en-US');

      expect(document.documentElement.lang).toBe('en-US');
      expect(i18nHarness.instance.addResourceBundle).not.toHaveBeenCalled();
    });

    it('lazy-loads an unloaded language and reuses the translation cache', async () => {
      const module = await importRendererI18n();
      const handler = i18nHarness.languageChangedHandlers[0];

      await handler?.('de-DE');
      expect(document.documentElement.lang).toBe('de-DE');
      expect(module.getLoadedLanguages()).toEqual(['en-US', 'de-DE']);

      i18nHarness.resourceBundles.delete('de-DE');
      i18nHarness.instance.addResourceBundle.mockClear();
      await handler?.('de-DE');
      expect(i18nHarness.instance.addResourceBundle).toHaveBeenCalledWith(
        'de-DE',
        'translation',
        expect.any(Object),
        true,
        true
      );
      expect(module.getLoadedLanguages()).toEqual(['en-US', 'de-DE']);
    });

    it('reports a lazy-load installation failure and leaves the language published', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      await importRendererI18n();
      const handler = i18nHarness.languageChangedHandlers[0];
      i18nHarness.instance.addResourceBundle.mockImplementationOnce(() => {
        throw new Error('bundle rejected');
      });

      await handler?.('de-DE');

      expect(document.documentElement.lang).toBe('de-DE');
      expect(consoleError).toHaveBeenCalledWith('Failed to load language de-DE:', expect.any(Error));
    });
  });

  describe('main-process synchronization', () => {
    it('skips an echoed language and switches an external language exactly once', async () => {
      await importRendererI18n();
      const handler = ipcHarness.getLanguageChangedHandler();

      await handler({ language: 'en-US' });
      expect(i18nHarness.instance.changeLanguage).not.toHaveBeenCalled();

      await handler({ language: 'tr_TR' });
      expect(i18nHarness.instance.changeLanguage).toHaveBeenCalledWith('tr-TR');
      expect(localStorage.getItem('i18nextLng')).toBe('tr-TR');
    });

    it('keeps initial, authoritative, IPC, and public switching functional without Web Storage', async () => {
      configHarness.whenReady.mockResolvedValue(undefined);
      configHarness.get.mockReturnValue('de-DE');
      vi.stubGlobal('localStorage', undefined);

      const module = await importRendererI18n();

      await vi.waitFor(() => expect(document.documentElement.lang).toBe('de-DE'));
      await ipcHarness.getLanguageChangedHandler()({ language: 'tr-TR' });
      await module.changeLanguage('fa-IR');

      expect(document.documentElement.lang).toBe('fa-IR');
      expect(i18nHarness.instance.changeLanguage).toHaveBeenCalledWith('de-DE');
      expect(i18nHarness.instance.changeLanguage).toHaveBeenCalledWith('tr-TR');
      expect(configHarness.set).toHaveBeenCalledWith('language', 'fa-IR');
      expect(ipcHarness.invoke).toHaveBeenCalledWith({ language: 'fa-IR' });
    });
  });

  describe('public helpers', () => {
    it('changes language, persists the preference, and tolerates notification failure', async () => {
      ipcHarness.invoke.mockRejectedValue(new Error('main unavailable'));
      const module = await importRendererI18n();

      await module.changeLanguage('de_DE');
      await Promise.resolve();

      expect(i18nHarness.instance.changeLanguage).toHaveBeenCalledWith('de-DE');
      expect(configHarness.set).toHaveBeenCalledWith('language', 'de-DE');
      expect(localStorage.getItem('i18nextLng')).toBe('de-DE');
      expect(ipcHarness.invoke).toHaveBeenCalledWith({ language: 'de-DE' });
    });

    it('clears cached translations and reloads the default locale on demand', async () => {
      const module = await importRendererI18n();
      expect(module.getLoadedLanguages()).toEqual(['en-US']);

      module.clearTranslationCache();
      i18nHarness.resourceBundles.delete('en-US');
      expect(module.getLoadedLanguages()).toEqual([]);

      await module.changeLanguage('en-US');
      expect(module.getLoadedLanguages()).toEqual(['en-US']);
    });

    it('does not write settings or notify main when switching fails', async () => {
      i18nHarness.failChangeLanguage(new Error('switch failed'));
      const module = await importRendererI18n();

      await expect(module.changeLanguage('de-DE')).rejects.toThrow('switch failed');
      expect(configHarness.set).not.toHaveBeenCalled();
      expect(ipcHarness.invoke).not.toHaveBeenCalled();
    });

    it('re-exports the shared normalizer and supported language inventory', async () => {
      const module = await importRendererI18n();

      expect(module.normalizeLanguageCode('ja_JP')).toBe('ja-JP');
      expect(module.supportedLanguages).toContain('fa-IR');
      expect(module.default).toBe(i18nHarness.instance);
    });
  });
});
