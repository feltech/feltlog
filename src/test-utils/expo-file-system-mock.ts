// Minimal mock for the expo-file-system module used by backup logic.
// This is a copy of the __mocks__/expo-file-system.ts implementation,
// extracted to a regular module so test files can reference it without
// triggering Jest's recursive mock resolution.

const mockFiles: Record<
  string,
  { modificationTime: number; size: number; exists: boolean; content?: string }
> = {};

/** Helper for tests: reset mock state between tests. */
export function __resetMockFiles(): void {
  Object.keys(mockFiles).forEach(k => delete mockFiles[k]);
}

/**
 * Helper for tests: set up a mock file.
 *
 * @param uri - The mock file URI.
 * @param data - The mock file metadata and content.
 * @param data.modificationTime - The file modification time in epoch seconds.
 * @param data.size - The file size in bytes.
 * @param data.content - Optional file content string.
 */
export function __setMockFile(
  uri: string,
  data: { modificationTime: number; size: number; content?: string },
): void {
  mockFiles[uri] = { ...data, exists: true };
}

export const documentDirectory = 'file:///mock-documents/';
export const cacheDirectory = 'file:///mock-cache/';

export enum EncodingType {
  UTF8 = 'utf8',
  Base64 = 'base64',
}

export const getInfoAsync = jest.fn(async (fileUri: string) => {
  const file = mockFiles[fileUri];
  if (file) {
    return {
      exists: true,
      isDirectory: false,
      modificationTime: file.modificationTime,
      size: file.size,
      uri: fileUri,
    };
  }
  return {
    exists: false,
    isDirectory: false,
    modificationTime: 0,
    size: 0,
    uri: fileUri,
  };
});

export const readAsStringAsync = jest.fn(
  async (fileUri: string, options?: { encoding?: string }) => {
    void options;
    const file = mockFiles[fileUri];
    if (!file || !file.content) throw new Error(`Mock file not found: ${fileUri}`);
    return file.content;
  },
);

export const writeAsStringAsync = jest.fn(
  async (fileUri: string, contents: string, options?: { encoding?: string }) => {
    void options;
    mockFiles[fileUri] = {
      modificationTime: Date.now() / 1000,
      size: contents.length,
      exists: true,
      content: contents,
    };
  },
);

export const deleteAsync = jest.fn(async (fileUri: string) => {
  delete mockFiles[fileUri];
});

export const copyAsync = jest.fn(async (options: { from: string; to: string }) => {
  const source = mockFiles[options.from];
  if (!source) throw new Error(`Mock source file not found: ${options.from}`);
  mockFiles[options.to] = { ...source };
});

// StorageAccessFramework API
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StorageAccessFramework {
  export const requestDirectoryPermissionsAsync = jest.fn(async () => {
    return {
      granted: true,
      directoryUri: 'content://mock-saf-directory',
    };
  });

  export const readDirectoryAsync = jest.fn(async (dirUri: string) => {
    // Return SAF URIs for files that match the mock state
    return Object.keys(mockFiles).filter(
      f => f.startsWith(dirUri + '/') || f.startsWith('content://mock-saf'),
    );
  });

  export const createFileAsync = jest.fn(
    async (parentUri: string, fileName: string, mimeType: string): Promise<string> => {
      void mimeType;
      const fileUri = `${parentUri}/${fileName}`;
      mockFiles[fileUri] = { modificationTime: Date.now() / 1000, size: 0, exists: true };
      return fileUri;
    },
  );

  export const getUriForDirectoryInRoot = jest.fn((folderName: string) => {
    return `content://mock-saf-root/${folderName}`;
  });

  export const makeDirectoryAsync = jest.fn(async (parentUri: string, dirName: string) => {
    const dirUri = `${parentUri}/${dirName}`;
    return dirUri;
  });
}

// Also export as FileSystem namespace for compatibility with code that expects it
export const FileSystem = {
  documentDirectory: 'file:///mock-documents/',
  cacheDirectory: 'file:///mock-cache/',

  EncodingType: {
    UTF8: 'utf8',
    Base64: 'base64',
  },

  getInfoAsync: jest.fn(getInfoAsync),
  readAsStringAsync: jest.fn(readAsStringAsync),
  writeAsStringAsync: jest.fn(writeAsStringAsync),
  deleteAsync: jest.fn(deleteAsync),
  copyAsync: jest.fn(copyAsync),
};

export default {
  documentDirectory,
  cacheDirectory,
  EncodingType,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  copyAsync,
  FileSystem,
  StorageAccessFramework,
};
