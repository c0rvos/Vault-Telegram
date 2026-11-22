export {};

declare global {
  interface VaultTelegramUser {
    id: number;
    firstName?: string;
    username?: string;
  }

  interface VaultTelegramSettings {
    apiId: string;
    apiHash?: string;
    phone: string;
    channels: string[];
    channel?: string;
    autoPush: boolean;
    hasSession: boolean;
    user: VaultTelegramUser | null;
    lastSyncAt: number;
  }

  interface VaultTelegramScannedFile {
    name: string;
    size: number;
    folder: string;
    msg: number;
    fid: string;
  }

  interface VaultTelegramScannedChannel {
    id: number;
    title: string;
    username?: string;
    files: VaultTelegramScannedFile[];
  }

  interface VaultTelegramApi {
    getSettings: () => Promise<VaultTelegramSettings>;
    saveSettings: (patch: Partial<VaultTelegramSettings>) => Promise<VaultTelegramSettings>;
    login: (input: {
      apiId: string;
      apiHash: string;
      phone: string;
    }) => Promise<{ ok: boolean } & VaultTelegramSettings>;
    submit: (kind: "code" | "password", value: string) => Promise<boolean>;
    logout: () => Promise<VaultTelegramSettings>;
    pushFolders: (
      channels: string[] | string,
      folders: string[]
    ) => Promise<{ ok: boolean; unchanged: boolean; folders: number; messages: number; channels: string[] }>;
    pullFolders: (
      channels: string[] | string
    ) => Promise<{ ok: boolean; folders: string[]; at: number; channels: string[] }>;
    scanChannel: (
      channel: string
    ) => Promise<{ ok: boolean; channel: VaultTelegramScannedChannel }>;
    onNeed: (handler: (kind: "code" | "password") => void) => () => void;
  }

  interface VaultPythonStatus {
    status: string;
    running: boolean;
    samples: number;
    classes: number;
    accuracy: number | null;
  }

  interface VaultPythonSample {
    name: string;
    size: number;
    folder: string;
    dest: string;
  }

  interface VaultPythonPrediction {
    dest: string;
    folder: string;
    p: number;
  }

  interface VaultPythonTrainResult {
    learned: number;
    classes: number;
    accuracy: number | null;
    engine: "python";
  }

  interface VaultPythonApi {
    status: () => Promise<VaultPythonStatus>;
    reconnect: () => Promise<VaultPythonStatus>;
    train: (samples: VaultPythonSample[]) => Promise<VaultPythonTrainResult>;
    predict: (request: {
      name: string;
      folder: string;
      size: number;
      allowed: string[];
    }) => Promise<{ top: VaultPythonPrediction[] }>;
    learn: (sample: VaultPythonSample) => Promise<{ samples: number }>;
  }

  interface VaultBotStatus {
    running: boolean;
    tokenSet: boolean;
    username: string;
    lastError: string;
  }

  interface VaultBotState {
    token: string;
    botUsername: string;
    owner: number | null;
    auto: boolean;
    defaultChannels: number[];
    channels: Array<{ id: number; title: string; username?: string }>;
    files: Array<{
      id: number;
      name: string;
      size: number;
      folder: string;
      chat: number;
      at: number;
      where?: string;
      parts: Array<{ msg: number; fid: string }>;
    }>;
    folders: string[];
    pythonSamples: number;
  }

  interface VaultBotApi {
    connect: (token: string) => Promise<{ ok: boolean; username?: string; error?: string }>;
    status: () => Promise<VaultBotStatus>;
    setState: (state: VaultBotState) => Promise<VaultBotStatus>;
    onEvent: (handler: (type: string, payload: Record<string, any>) => any | Promise<any>) => () => void;
  }

  interface VaultWindowApi {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximized: (handler: (maximized: boolean) => void) => () => void;
  }

  interface Window {
    vaultDesktop?: {
      telegram: VaultTelegramApi;
      bot: VaultBotApi;
      python: VaultPythonApi;
      window: VaultWindowApi;
    };
  }
}
