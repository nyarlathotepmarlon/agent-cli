import {
    setTimeout as sleep,
} from "node:timers/promises";

import type {
    Delay,
} from "../../core/agent/delay.js";

export class NodeDelay
    implements Delay
{
    public async wait(
        milliseconds: number, // 需要等待的时间
        signal: AbortSignal, // 终止信号
    ): Promise<void> {
        signal.throwIfAborted();

        await sleep(
            milliseconds,
            undefined,
            {
                signal,
            },
        );
    }
}