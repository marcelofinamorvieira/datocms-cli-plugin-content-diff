import { type Options } from 'prettier';
import type * as Types from '../types';
export declare function write(commands: Types.Command[], { format, ...prettierOptions }: Options & {
    format: 'js' | 'ts';
}): Promise<string>;
