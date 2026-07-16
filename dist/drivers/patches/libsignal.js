export default {
    name: "libsignal-silence-decrypt-errors",
    apply() {
        const originalError = console.error;
        console.error = (...args) => {
            const message = args
                .map((arg) => String(arg))
                .join(" ");
            if (message.includes("Failed to decrypt message with any known session") ||
                message.includes("Session error:")) {
                return;
            }
            originalError(...args);
        };
    }
};
