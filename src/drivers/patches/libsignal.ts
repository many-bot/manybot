import type { Patch } from "./patch.js";

export default {
    name: "libsignal-silence-decrypt-errors",

    apply() {
        const originalError = console.error;

        console.error = (...args: unknown[]) => {
            const message = args
                .map((arg) => String(arg))
                .join(" ");

            if (
                message.includes(
                    "Failed to decrypt message with any known session"
                ) ||
                message.includes("Session error:")
            ) {
                return;
            }

            originalError(...args);
        };
    }
} satisfies Patch;
