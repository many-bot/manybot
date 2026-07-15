import libsignal from "./libsignal.js";

const patches = [
    libsignal
];

export function applyPatches() {
    for (const patch of patches) {
        patch.apply();
    }
}
