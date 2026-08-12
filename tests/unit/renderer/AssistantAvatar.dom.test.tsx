/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression for WP #24095 ("Loose icon images"): an avatar whose image src
 * fails to load must fall back to the icon, never the browser broken-image glyph.
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ConfigProvider } from '@arco-design/web-react';

import AssistantAvatar from '@/renderer/pages/settings/AssistantSettings/AssistantAvatar';
import type { AssistantListItem } from '@/renderer/pages/settings/AssistantSettings/types';

const assistant = (avatar: string): AssistantListItem => ({ avatar, name: 'Aria' }) as AssistantListItem;

const renderAvatar = (ui: React.ReactElement) => render(<ConfigProvider>{ui}</ConfigProvider>);

describe('AssistantAvatar', () => {
  afterEach(cleanup);

  it('renders the image while it loads', () => {
    const { container } = renderAvatar(<AssistantAvatar assistant={assistant('https://cdn.example/a.png')} />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cdn.example/a.png');
  });

  it('falls back to the icon when the image fails to load (no broken-image glyph)', () => {
    const { container } = renderAvatar(<AssistantAvatar assistant={assistant('https://cdn.example/missing.png')} />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    fireEvent.error(img as HTMLImageElement);

    // The broken <img> is dropped in favour of the fallback icon (svg).
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders an emoji avatar without an image', () => {
    const { container } = renderAvatar(<AssistantAvatar assistant={assistant('🤖')} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('🤖');
  });
});
