import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// The real i18n runtime, with the real resources. Tests then assert the copy a
// visitor actually reads rather than a key or a stub, so a missing translation
// fails a test instead of shipping.
import i18n from '../i18n';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Language is global state. Without a reset, a test that switches to Chinese
// leaves every later test asserting English against a Chinese UI, and the
// failure appears in an unrelated file.
beforeEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

// jsdom implements neither observer; components under test rely on both.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

vi.stubGlobal('IntersectionObserver', NoopObserver);
vi.stubGlobal('ResizeObserver', NoopObserver);
