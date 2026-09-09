export interface Delay {
    wait(
        milliseconds: number,
        signal: AbortSignal,
    ): Promise<void>;
}