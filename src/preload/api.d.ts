import type { LucidSSHBridge } from './index';

declare global {
  interface Window {
    lucidSSH: LucidSSHBridge;
  }
}

export {};
