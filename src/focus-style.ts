import type { Theme } from "@earendil-works/pi-coding-agent";

/** Reserve inverse + bold for the control receiving keyboard input, not selection. */
export function focusStyle(theme: Theme, text: string): string {
    // truncateToWidth can insert resets even into plain text. Remove those before
    // applying the outer style, or a truncated row loses its highlight halfway.
    const plain = text.replace(/\x1b\[0m/g, "");
    return theme.fg("accent", `\x1b[1m\x1b[7m${plain}\x1b[27m\x1b[22m`);
}
