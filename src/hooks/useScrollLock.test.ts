/// <reference types="bun-types" />
import { describe, it, expect, afterEach } from 'bun:test';
import { renderHook } from '../test/renderHook';
import { useScrollLock } from './useScrollLock';

afterEach(() => {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

describe('useScrollLock', () => {
  it('does nothing when inactive', () => {
    renderHook(({ active }) => useScrollLock(active), { initialProps: { active: false } });
    expect(document.body.style.overflow).toBe('');
  });

  it('locks body overflow while active and restores it on unmount', () => {
    const { unmount } = renderHook(({ active }) => useScrollLock(active), {
      initialProps: { active: true },
    });
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps the lock until the last of several consumers unmounts', () => {
    const first = renderHook(({ active }) => useScrollLock(active), {
      initialProps: { active: true },
    });
    const second = renderHook(({ active }) => useScrollLock(active), {
      initialProps: { active: true },
    });
    expect(document.body.style.overflow).toBe('hidden');

    first.unmount();
    expect(document.body.style.overflow).toBe('hidden'); // second still holds the lock

    second.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
