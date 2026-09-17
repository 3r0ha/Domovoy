import type { Plugin } from 'vite';

/** Сжатые копии статики рядом с исходными файлами. */
export declare const precompress: (options?: { minBytes?: number }) => Plugin;
