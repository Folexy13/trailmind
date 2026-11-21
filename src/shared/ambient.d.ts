declare module '@huggingface/transformers' {
  export const env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    [key: string]: unknown;
  };
  export function pipeline(
    task: string,
    model?: string,
    options?: Record<string, unknown>,
  ): Promise<
    (
      text: string,
      options?: { pooling?: string; normalize?: boolean },
    ) => Promise<{ data: Float32Array | number[] }>
  >;
}

declare module 'chrono-node' {
  export interface ParsedComponents {
    date(): Date;
    isCertain(component: string): boolean;
  }
  export interface ParsedResult {
    text: string;
    index: number;
    start: ParsedComponents;
    end?: ParsedComponents;
  }
  export function parse(
    text: string,
    referenceDate?: Date,
    options?: { forwardDate?: boolean },
  ): ParsedResult[];
}
