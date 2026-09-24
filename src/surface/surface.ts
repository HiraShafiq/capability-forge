import type { Locator, Observation, TargetSchema } from '../core/schemas.js';
import type { z } from 'zod';

export type Target = z.infer<typeof TargetSchema>;

export interface Surface {
  currentUrl(): string;
  observe(): Promise<Observation>;
  navigate(url: string): Promise<void>;
  click(target: Target): Promise<void>;
  type(target: Target, value: string, clear?: boolean): Promise<void>;
  read(target: Target): Promise<string>;
  exists(target: Target): Promise<boolean>;
  screenshot(path: string): Promise<void>;
  content(): Promise<string>;
  clickCoordinates(x: number, y: number): Promise<void>;
  typeRaw(value: string): Promise<void>;
  resolveLocator(locator: Locator): Promise<number>;
  close(): Promise<void>;
}
